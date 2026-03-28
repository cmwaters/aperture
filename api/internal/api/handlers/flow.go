package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FlowHandler struct {
	DB *pgxpool.Pool
}

// ── Response types ────────────────────────────────────────────────────────────

type FlowSegment struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
	Kind  string    `json:"kind"` // "reviewer" | "author"
}

type FlowPR struct {
	ID              string        `json:"id"`
	Number          int           `json:"number"`
	Title           string        `json:"title"`
	AuthorLogin     string        `json:"author_github_login"`
	AuthorAvatarURL *string       `json:"author_avatar_url,omitempty"`
	RepoFullName    string        `json:"repo_full_name"`
	State           string        `json:"state"`
	OpenedAt        time.Time     `json:"opened_at"`
	ClosedAt        *time.Time    `json:"closed_at,omitempty"`
	MergedAt        *time.Time    `json:"merged_at,omitempty"`
	HTMLURL         string        `json:"html_url"`
	Segments        []FlowSegment `json:"segments"`
	TotalHours      float64       `json:"total_hours"`
	ReviewerHours   float64       `json:"reviewer_hours"`
	AuthorHours     float64       `json:"author_hours"`
}

type FlowReviewer struct {
	Login            string  `json:"login"`
	AvatarURL        *string `json:"avatar_url,omitempty"`
	Reviews          int     `json:"reviews"`
	Approvals        int     `json:"approvals"`
	ChangesRequested int     `json:"changes_requested"`
	AuthoredPRs      int     `json:"authored_prs"`
}

type WeekStat struct {
	Week          string   `json:"week"`           // Monday ISO date yyyy-mm-dd
	ReviewedCount int      `json:"reviewed_count"` // PRs opened this week that got at least one review
	MergedCount   int      `json:"merged_count"`   // PRs merged this calendar week
	Min           *float64 `json:"min,omitempty"`
	Q1            *float64 `json:"q1,omitempty"`
	Median        *float64 `json:"median,omitempty"`
	Mean          *float64 `json:"mean,omitempty"`
	Q3            *float64 `json:"q3,omitempty"`
	Max           *float64 `json:"max,omitempty"`
}

type FlowResponse struct {
	PRs         []FlowPR       `json:"prs"`
	Reviewers   []FlowReviewer `json:"reviewers"`
	WeeklyStats []WeekStat     `json:"weekly_stats"`
	PeriodDays  int            `json:"period_days"`
}

// ── Weekly stats helper ───────────────────────────────────────────────────────

func (h *FlowHandler) queryWeeklyStats(ctx context.Context, orgID string) []WeekStat {
	since := time.Now().UTC().AddDate(0, 0, -7*12) // last 12 weeks

	rows, err := h.DB.Query(ctx, `
		WITH
		-- First review for each PR, only from Aperture org members (excludes bots)
		first_reviews AS (
			SELECT prv.pull_request_id, MIN(prv.submitted_at) AS first_review_at
			FROM pr_reviews prv
			JOIN users u ON lower(u.github_username) = lower(prv.reviewer_login)
			JOIN org_members om ON om.user_id = u.id AND om.org_id = $1
			GROUP BY prv.pull_request_id
		),
		-- Hours from PR open to first review, bucketed by week opened
		pr_ttfr AS (
			SELECT
				date_trunc('week', pr.opened_at)::date AS week_start,
				GREATEST(
					EXTRACT(EPOCH FROM (fr.first_review_at - pr.opened_at)) / 3600.0,
					0
				) AS hrs
			FROM pull_requests pr
			JOIN first_reviews fr ON fr.pull_request_id = pr.id
			WHERE pr.org_id   = $1
			  AND pr.draft    = false
			  AND pr.opened_at >= $2
			  AND fr.first_review_at > pr.opened_at
		),
		-- PRs merged, bucketed by week of merge
		merged_pw AS (
			SELECT
				date_trunc('week', merged_at)::date AS week_start,
				COUNT(*) AS merged_count
			FROM pull_requests
			WHERE org_id   = $1
			  AND draft    = false
			  AND merged_at IS NOT NULL
			  AND merged_at >= $2
			GROUP BY 1
		),
		-- Generate every week in range so we have no gaps
		weeks AS (
			SELECT generate_series(
				date_trunc('week', $2::timestamptz)::date,
				date_trunc('week', now())::date,
				'1 week'
			)::date AS week_start
		)
		SELECT
			w.week_start,
			COUNT(t.hrs)::int                                                   AS reviewed_count,
			COALESCE(mpw.merged_count, 0)::int                                  AS merged_count,
			MIN(t.hrs)                                                          AS min_hrs,
			PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY t.hrs)                AS q1,
			PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY t.hrs)                AS median,
			AVG(t.hrs)                                                          AS mean,
			PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY t.hrs)                AS q3,
			MAX(t.hrs)                                                          AS max_hrs
		FROM weeks w
		LEFT JOIN pr_ttfr    t   ON t.week_start   = w.week_start
		LEFT JOIN merged_pw  mpw ON mpw.week_start = w.week_start
		GROUP BY w.week_start, mpw.merged_count
		ORDER BY w.week_start
	`, orgID, since)
	if err != nil {
		log.Printf("queryWeeklyStats: %v", err)
		return nil
	}
	defer rows.Close()

	var stats []WeekStat
	for rows.Next() {
		var s WeekStat
		var weekDate time.Time
		var reviewedCount, mergedCount int
		var minH, q1, median, mean, q3, maxH *float64
		if err := rows.Scan(&weekDate, &reviewedCount, &mergedCount, &minH, &q1, &median, &mean, &q3, &maxH); err != nil {
			continue
		}
		s.Week = weekDate.Format("2006-01-02")
		s.ReviewedCount = reviewedCount
		s.MergedCount = mergedCount
		s.Min = minH
		s.Q1 = q1
		s.Median = median
		s.Mean = mean
		s.Q3 = q3
		s.Max = maxH
		stats = append(stats, s)
	}
	if stats == nil {
		stats = []WeekStat{}
	}
	return stats
}

// ── Handler ───────────────────────────────────────────────────────────────────

func (h *FlowHandler) GetFlow(w http.ResponseWriter, r *http.Request) {
	orgSlug := chi.URLParam(r, "orgSlug")

	periodDays := 7
	if p := r.URL.Query().Get("period"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n <= 365 {
			periodDays = n
		}
	}

	since := time.Now().UTC().AddDate(0, 0, -periodDays)
	ctx := r.Context()

	var orgID string
	if err := h.DB.QueryRow(ctx, `SELECT id FROM organizations WHERE slug = $1`, orgSlug).Scan(&orgID); err != nil {
		http.Error(w, "org not found", http.StatusNotFound)
		return
	}

	// ── Fetch PRs ──────────────────────────────────────────────────────────────
	// Only include PRs that have been closed/merged within the period.
	// Open PRs are excluded — their cycle time is not yet known.
	rows, err := h.DB.Query(ctx, `
		SELECT
			pr.id, pr.number, pr.title,
			pr.author_github_login, pr.author_avatar_url,
			r.full_name, pr.state, pr.html_url,
			pr.opened_at, pr.closed_at, pr.merged_at
		FROM pull_requests pr
		JOIN repositories r ON r.id = pr.repo_id
		WHERE pr.org_id = $1
		  AND pr.draft = false
		  AND pr.closed_at IS NOT NULL
		  AND pr.closed_at >= $2
		ORDER BY pr.closed_at DESC
	`, orgID, since)
	if err != nil {
		log.Printf("GetFlow: PR query error: %v", err)
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	type prRow struct {
		id       string
		number   int
		title    string
		author   string
		avatar   *string
		repo     string
		state    string
		htmlURL  string
		openedAt time.Time
		closedAt *time.Time
		mergedAt *time.Time
	}

	var prs []prRow
	var prIDs []string
	for rows.Next() {
		var p prRow
		if err := rows.Scan(&p.id, &p.number, &p.title, &p.author, &p.avatar,
			&p.repo, &p.state, &p.htmlURL, &p.openedAt, &p.closedAt, &p.mergedAt); err != nil {
			continue
		}
		prs = append(prs, p)
		prIDs = append(prIDs, p.id)
	}
	rows.Close()

	// ── Fetch reviews ─────────────────────────────────────────────────────────
	type reviewRow struct {
		prID        string
		login       string
		avatarURL   *string
		state       string
		submittedAt time.Time
	}
	reviewsByPR := map[string][]reviewRow{}

	if len(prIDs) > 0 {
		revRows, err := h.DB.Query(ctx, `
			SELECT pull_request_id, reviewer_login, reviewer_avatar_url, state, submitted_at
			FROM pr_reviews
			WHERE pull_request_id = ANY($1)
			  AND state IN ('approved', 'changes_requested')
			ORDER BY submitted_at ASC
		`, prIDs)
		if err != nil {
			log.Printf("GetFlow: review query error: %v", err)
		} else {
			defer revRows.Close()
			for revRows.Next() {
				var rv reviewRow
				if err := revRows.Scan(&rv.prID, &rv.login, &rv.avatarURL, &rv.state, &rv.submittedAt); err == nil {
					reviewsByPR[rv.prID] = append(reviewsByPR[rv.prID], rv)
				}
			}
		}
	}

	// ── Build response ────────────────────────────────────────────────────────
	now := time.Now().UTC()

	type reviewerStats struct {
		login     string
		avatarURL *string
		reviews   int
		approvals int
		changes   int
	}
	reviewerMap := map[string]*reviewerStats{}
	authorCount := map[string]int{}

	flowPRs := make([]FlowPR, 0, len(prs))

	for _, p := range prs {
		reviews := reviewsByPR[p.id]

		endTime := now
		if p.closedAt != nil {
			endTime = *p.closedAt
		}

		// Build timeline segments.
		// Invariant: ball starts with the reviewer; after any decision review
		// (approved or changes_requested) the ball moves to the author.
		segments := make([]FlowSegment, 0, len(reviews)+1)
		kind := "reviewer"
		cursor := p.openedAt

		for _, rv := range reviews {
			if rv.submittedAt.After(cursor) {
				segments = append(segments, FlowSegment{Start: cursor, End: rv.submittedAt, Kind: kind})
				cursor = rv.submittedAt
			}
			kind = "author"
		}
		if endTime.After(cursor) {
			segments = append(segments, FlowSegment{Start: cursor, End: endTime, Kind: kind})
		}

		totalHours := endTime.Sub(p.openedAt).Hours()
		reviewerHours, authorHours := 0.0, 0.0
		for _, s := range segments {
			dur := s.End.Sub(s.Start).Hours()
			if s.Kind == "reviewer" {
				reviewerHours += dur
			} else {
				authorHours += dur
			}
		}

		flowPRs = append(flowPRs, FlowPR{
			ID:              p.id,
			Number:          p.number,
			Title:           p.title,
			AuthorLogin:     p.author,
			AuthorAvatarURL: p.avatar,
			RepoFullName:    p.repo,
			State:           p.state,
			OpenedAt:        p.openedAt,
			ClosedAt:        p.closedAt,
			MergedAt:        p.mergedAt,
			HTMLURL:         p.htmlURL,
			Segments:        segments,
			TotalHours:      totalHours,
			ReviewerHours:   reviewerHours,
			AuthorHours:     authorHours,
		})

		authorCount[p.author]++

		for _, rv := range reviews {
			if _, ok := reviewerMap[rv.login]; !ok {
				reviewerMap[rv.login] = &reviewerStats{login: rv.login, avatarURL: rv.avatarURL}
			}
			rs := reviewerMap[rv.login]
			rs.reviews++
			if rv.state == "approved" {
				rs.approvals++
			} else {
				rs.changes++
			}
		}
	}

	flowReviewers := make([]FlowReviewer, 0, len(reviewerMap))
	for login, rs := range reviewerMap {
		flowReviewers = append(flowReviewers, FlowReviewer{
			Login:            login,
			AvatarURL:        rs.avatarURL,
			Reviews:          rs.reviews,
			Approvals:        rs.approvals,
			ChangesRequested: rs.changes,
			AuthoredPRs:      authorCount[login],
		})
	}
	sort.Slice(flowReviewers, func(i, j int) bool {
		return flowReviewers[i].Reviews > flowReviewers[j].Reviews
	})

	// ── Weekly stats (last 12 weeks, independent of period filter) ───────────
	weeklyStats := h.queryWeeklyStats(ctx, orgID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(FlowResponse{
		PRs:         flowPRs,
		Reviewers:   flowReviewers,
		WeeklyStats: weeklyStats,
		PeriodDays:  periodDays,
	})
}
