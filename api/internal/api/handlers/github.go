package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aperture/api/internal/github"
	"github.com/jackc/pgx/v5/pgxpool"
)

type GitHubHandler struct {
	DB            *pgxpool.Pool
	AppClient     *github.AppClient
	WebhookSecret string
	FrontendURL   string
}

// POST /webhooks/github
// Receives and processes GitHub App webhook events.
func (h *GitHubHandler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := github.ReadAndVerify(r, h.WebhookSecret)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	event := r.Header.Get("X-GitHub-Event")
	switch event {
	case "pull_request":
		h.handlePREvent(r.Context(), body)
	case "installation":
		h.handleInstallationEvent(r.Context(), body)
	case "ping":
		// GitHub sends a ping on webhook creation — just acknowledge
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *GitHubHandler) handlePREvent(ctx context.Context, body []byte) {
	payload, err := github.ParsePRPayload(body)
	if err != nil {
		log.Printf("error parsing PR payload: %v", err)
		return
	}

	// Only process relevant actions
	switch payload.Action {
	case "opened", "synchronize", "reopened", "ready_for_review", "closed":
	default:
		return
	}

	// Look up the team + repo for this installation
	var teamID, repoID string
	err = h.DB.QueryRow(ctx, `
		select r.team_id, r.id
		from repositories r
		join github_installations gi on gi.id = r.installation_id
		where gi.installation_id = $1
		  and r.github_repo_id = $2
		  and r.is_active = true
	`, payload.Installation.ID, payload.Repository.ID).Scan(&teamID, &repoID)
	if err != nil {
		// Repo not tracked, ignore
		return
	}

	pr := payload.PullRequest
	state := pr.State
	if pr.MergedAt != nil {
		state = "merged"
	}

	lastActivity := pr.UpdatedAt
	now := time.Now()

	_, err = h.DB.Exec(ctx, `
		insert into pull_requests (
			team_id, repo_id, github_pr_id, number, title, body,
			author_github_login, author_avatar_url, base_branch, head_branch,
			state, draft, additions, deletions, changed_files, html_url,
			opened_at, closed_at, merged_at, last_activity_at, last_synced_at,
			updated_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
		on conflict (repo_id, github_pr_id) do update set
			title = excluded.title,
			body = excluded.body,
			state = excluded.state,
			draft = excluded.draft,
			additions = excluded.additions,
			deletions = excluded.deletions,
			changed_files = excluded.changed_files,
			closed_at = excluded.closed_at,
			merged_at = excluded.merged_at,
			last_activity_at = excluded.last_activity_at,
			last_synced_at = excluded.last_synced_at,
			updated_at = excluded.updated_at
	`,
		teamID, repoID, pr.ID, pr.Number, pr.Title, pr.Body,
		pr.User.Login, pr.User.AvatarURL, pr.Base.Ref, pr.Head.Ref,
		state, pr.Draft, pr.Additions, pr.Deletions, pr.ChangedFiles, pr.HTMLURL,
		pr.CreatedAt, pr.ClosedAt, pr.MergedAt, lastActivity, now, now,
	)
	if err != nil {
		log.Printf("error upserting PR %d: %v", pr.Number, err)
	}
}

func (h *GitHubHandler) handleInstallationEvent(ctx context.Context, body []byte) {
	payload, err := github.ParseInstallationPayload(body)
	if err != nil {
		log.Printf("error parsing installation payload: %v", err)
		return
	}
	if payload.Action == "deleted" {
		_, _ = h.DB.Exec(ctx,
			`delete from github_installations where installation_id = $1`,
			payload.Installation.ID,
		)
	}
}

// GET /api/v1/github/callback?installation_id=…&team_id=…
// Called after the user installs the GitHub App. Stores the installation and
// syncs the repos available to it.
func (h *GitHubHandler) HandleInstallationCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	installationIDStr := r.URL.Query().Get("installation_id")
	teamID := r.URL.Query().Get("state") // we pass team_id as the OAuth state param

	if installationIDStr == "" || teamID == "" {
		http.Error(w, "missing installation_id or state", http.StatusBadRequest)
		return
	}

	var installationID int64
	fmt.Sscanf(installationIDStr, "%d", &installationID)

	// Get installation token
	token, err := h.AppClient.InstallationToken(ctx, installationID)
	if err != nil {
		http.Error(w, "failed to get installation token", http.StatusInternalServerError)
		return
	}
	ghClient := github.NewClient(token)

	// Fetch repos accessible to this installation
	repos, err := ghClient.ListInstallationRepos(ctx)
	if err != nil {
		http.Error(w, "failed to fetch repos", http.StatusInternalServerError)
		return
	}
	if len(repos) == 0 {
		http.Redirect(w, r, h.FrontendURL+"/onboarding/repos?error=no_repos", http.StatusFound)
		return
	}

	// Determine account info from the first repo's owner
	accountLogin := strings.Split(repos[0].FullName, "/")[0]
	accountAvatarURL := fmt.Sprintf("https://github.com/%s.png", accountLogin)

	// Upsert installation
	var dbInstallationID string
	err = h.DB.QueryRow(ctx, `
		insert into github_installations (team_id, installation_id, account_login, account_type, account_avatar_url)
		values ($1, $2, $3, $4, $5)
		on conflict (installation_id) do update set
			account_login = excluded.account_login,
			account_avatar_url = excluded.account_avatar_url
		returning id
	`, teamID, installationID, accountLogin, "Organization", accountAvatarURL).Scan(&dbInstallationID)
	if err != nil {
		http.Error(w, "failed to save installation", http.StatusInternalServerError)
		return
	}

	// Upsert repos
	for _, repo := range repos {
		_, err := h.DB.Exec(ctx, `
			insert into repositories (team_id, installation_id, github_repo_id, full_name, default_branch)
			values ($1, $2, $3, $4, $5)
			on conflict (team_id, github_repo_id) do update set
				full_name = excluded.full_name,
				default_branch = excluded.default_branch
		`, teamID, dbInstallationID, repo.ID, repo.FullName, repo.DefaultBranch)
		if err != nil {
			log.Printf("error upserting repo %s: %v", repo.FullName, err)
		}
	}

	// Redirect back to frontend repo selection page
	http.Redirect(w, r, h.FrontendURL+"/onboarding/repos?installation_id="+installationIDStr, http.StatusFound)
}

// GET /api/v1/teams/{teamSlug}/repos
func (h *GitHubHandler) ListRepos(w http.ResponseWriter, r *http.Request) {
	// Handled in repos handler - wired here for convenience
}

// POST /api/v1/teams/{teamSlug}/repos/{repoID}/sync
// Triggers a full sync of open PRs for a given repo.
func (h *GitHubHandler) SyncRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	repoID := r.PathValue("repoID")

	var installationID int64
	var fullName string
	var teamID string
	err := h.DB.QueryRow(ctx, `
		select gi.installation_id, r.full_name, r.team_id
		from repositories r
		join github_installations gi on gi.id = r.installation_id
		where r.id = $1 and r.is_active = true
	`, repoID).Scan(&installationID, &fullName, &teamID)
	if err != nil {
		http.Error(w, "repo not found", http.StatusNotFound)
		return
	}

	ghClient, err := h.AppClient.ClientForInstallation(ctx, installationID)
	if err != nil {
		http.Error(w, "failed to authenticate with GitHub", http.StatusInternalServerError)
		return
	}

	parts := strings.SplitN(fullName, "/", 2)
	if len(parts) != 2 {
		http.Error(w, "invalid repo name", http.StatusInternalServerError)
		return
	}
	owner, repo := parts[0], parts[1]

	prs, err := ghClient.ListOpenPullRequests(ctx, owner, repo)
	if err != nil {
		http.Error(w, "failed to fetch PRs from GitHub", http.StatusInternalServerError)
		return
	}

	now := time.Now()
	for _, pr := range prs {
		state := pr.State
		if pr.MergedAt != nil {
			state = "merged"
		}
		_, err := h.DB.Exec(ctx, `
			insert into pull_requests (
				team_id, repo_id, github_pr_id, number, title, body,
				author_github_login, author_avatar_url, base_branch, head_branch,
				state, draft, additions, deletions, changed_files, html_url,
				opened_at, closed_at, merged_at, last_activity_at, last_synced_at,
				updated_at
			) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
			on conflict (repo_id, github_pr_id) do update set
				title = excluded.title,
				state = excluded.state,
				draft = excluded.draft,
				additions = excluded.additions,
				deletions = excluded.deletions,
				changed_files = excluded.changed_files,
				last_synced_at = excluded.last_synced_at,
				updated_at = excluded.updated_at
		`,
			teamID, repoID, pr.ID, pr.Number, pr.Title, pr.Body,
			pr.User.Login, pr.User.AvatarURL, pr.Base.Ref, pr.Head.Ref,
			state, pr.Draft, pr.Additions, pr.Deletions, pr.ChangedFiles, pr.HTMLURL,
			pr.CreatedAt, pr.ClosedAt, pr.MergedAt, pr.UpdatedAt, now, now,
		)
		if err != nil {
			log.Printf("error upserting PR #%d: %v", pr.Number, err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"synced": len(prs),
	})
}
