package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/aperture/api/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type QueueHandler struct {
	DB *pgxpool.Pool
}

// GET /api/v1/teams/{teamSlug}/queue
func (h *QueueHandler) GetQueue(w http.ResponseWriter, r *http.Request) {
	teamSlug := chi.URLParam(r, "teamSlug")
	ctx := r.Context()

	// Resolve team ID from slug
	var teamID string
	err := h.DB.QueryRow(ctx, `select id from teams where slug = $1`, teamSlug).Scan(&teamID)
	if err != nil {
		http.Error(w, "team not found", http.StatusNotFound)
		return
	}

	rows, err := h.DB.Query(ctx, `
		select
			pr.id, pr.team_id, pr.repo_id, pr.github_pr_id, pr.number, pr.title,
			pr.body, pr.author_github_login, pr.author_avatar_url,
			pr.base_branch, pr.head_branch, pr.state, pr.draft,
			pr.additions, pr.deletions, pr.changed_files, pr.html_url,
			pr.opened_at, pr.closed_at, pr.merged_at, pr.last_activity_at,
			pr.last_synced_at, pr.created_at, pr.updated_at,
			r.full_name as repo_full_name,
			pa.summary, pa.size_label, pa.risk_score, pa.risk_label,
			pa.impacted_areas, pa.risk_reasons
		from pull_requests pr
		join repositories r on r.id = pr.repo_id
		left join pr_analyses pa on pa.pull_request_id = pr.id
		where pr.team_id = $1
		  and pr.state = 'open'
		order by pr.last_activity_at desc nulls last
	`, teamID)
	if err != nil {
		http.Error(w, "failed to fetch queue", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var items []models.QueueItem
	for rows.Next() {
		var pr models.PullRequest
		var analysis models.PRAnalysis
		var repoFullName string

		err := rows.Scan(
			&pr.ID, &pr.TeamID, &pr.RepoID, &pr.GitHubPRID, &pr.Number, &pr.Title,
			&pr.Body, &pr.AuthorGitHubLogin, &pr.AuthorAvatarURL,
			&pr.BaseBranch, &pr.HeadBranch, &pr.State, &pr.Draft,
			&pr.Additions, &pr.Deletions, &pr.ChangedFiles, &pr.HTMLURL,
			&pr.OpenedAt, &pr.ClosedAt, &pr.MergedAt, &pr.LastActivityAt,
			&pr.LastSyncedAt, &pr.CreatedAt, &pr.UpdatedAt,
			&repoFullName,
			&analysis.Summary, &analysis.SizeLabel, &analysis.RiskScore, &analysis.RiskLabel,
			&analysis.ImpactedAreas, &analysis.RiskReasons,
		)
		if err != nil {
			continue
		}
		pr.RepoFullName = repoFullName

		if analysis.Summary != nil {
			pr.Analysis = &analysis
		}

		item := models.QueueItem{
			PullRequest:  pr,
			ReviewState:  computeReviewState(pr),
			WaitingHours: waitingHours(pr),
			UrgencyScore: computeUrgency(pr, analysis),
		}
		items = append(items, item)
	}

	// Sort by urgency descending
	sort.Slice(items, func(i, j int) bool {
		return items[i].UrgencyScore > items[j].UrgencyScore
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"items": items,
		"total": len(items),
	})
}

func waitingHours(pr models.PullRequest) float64 {
	ref := pr.OpenedAt
	if pr.LastActivityAt != nil {
		ref = *pr.LastActivityAt
	}
	return time.Since(ref).Hours()
}

func computeReviewState(pr models.PullRequest) string {
	if pr.Draft {
		return "draft"
	}
	// Without review data joined here, default to needs_review.
	// This will be enriched once we join pr_reviews.
	return "needs_review"
}

func computeUrgency(pr models.PullRequest, analysis models.PRAnalysis) float64 {
	// wait_time_score: normalise hours waiting (cap at 72h → 1.0)
	waitScore := math.Min(waitingHours(pr)/72.0, 1.0)

	// risk_score: 1–10 normalised to 0–1 (default 0.3 if unknown)
	riskScore := 0.3
	if analysis.RiskScore != nil {
		riskScore = float64(*analysis.RiskScore) / 10.0
	}

	// system_impact_score: number of impacted areas, cap at 5
	impactScore := math.Min(float64(len(analysis.ImpactedAreas))/5.0, 1.0)

	return (waitScore * 0.4) + (riskScore * 0.35) + (impactScore * 0.25)
}
