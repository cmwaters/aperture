package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/aperture/api/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TeamHandler struct {
	DB *pgxpool.Pool
}

// POST /api/v1/teams
// Creates a new team and makes the caller the owner.
func (h *TeamHandler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.Header.Get("X-User-ID") // set by auth middleware

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	slug := slugify(body.Name)

	var team models.Team
	err := h.DB.QueryRow(ctx,
		`insert into teams (name, slug) values ($1, $2) returning id, name, slug, created_at`,
		body.Name, slug,
	).Scan(&team.ID, &team.Name, &team.Slug, &team.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			http.Error(w, "a team with that name already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create team", http.StatusInternalServerError)
		return
	}

	// Add creator as owner
	_, err = h.DB.Exec(ctx,
		`insert into team_members (team_id, user_id, role) values ($1, $2, 'owner')`,
		team.ID, userID,
	)
	if err != nil {
		http.Error(w, "failed to add team member", http.StatusInternalServerError)
		return
	}

	// Create default preferences
	_, _ = h.DB.Exec(ctx,
		`insert into team_preferences (team_id) values ($1) on conflict do nothing`,
		team.ID,
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(team)
}

// GET /api/v1/teams/{teamSlug}
func (h *TeamHandler) GetTeam(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	teamSlug := chi.URLParam(r, "teamSlug")

	var team models.Team
	err := h.DB.QueryRow(ctx,
		`select id, name, slug, created_at from teams where slug = $1`,
		teamSlug,
	).Scan(&team.ID, &team.Name, &team.Slug, &team.CreatedAt)
	if err != nil {
		http.Error(w, "team not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(team)
}

// GET /api/v1/teams/{teamSlug}/repos
func (h *TeamHandler) ListRepos(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	teamSlug := chi.URLParam(r, "teamSlug")

	var teamID string
	err := h.DB.QueryRow(ctx, `select id from teams where slug = $1`, teamSlug).Scan(&teamID)
	if err != nil {
		http.Error(w, "team not found", http.StatusNotFound)
		return
	}

	rows, err := h.DB.Query(ctx, `
		select id, team_id, installation_id, github_repo_id, full_name, default_branch, is_active, created_at
		from repositories
		where team_id = $1
		order by full_name asc
	`, teamID)
	if err != nil {
		http.Error(w, "failed to fetch repos", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var repos []models.Repository
	for rows.Next() {
		var repo models.Repository
		if err := rows.Scan(
			&repo.ID, &repo.TeamID, &repo.InstallationID, &repo.GitHubRepoID,
			&repo.FullName, &repo.DefaultBranch, &repo.IsActive, &repo.CreatedAt,
		); err == nil {
			repos = append(repos, repo)
		}
	}
	if repos == nil {
		repos = []models.Repository{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"repos": repos,
	})
}

// PATCH /api/v1/teams/{teamSlug}/repos/{repoID}
// Toggle a repo active/inactive.
func (h *TeamHandler) UpdateRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repoID := chi.URLParam(r, "repoID")

	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	_, err := h.DB.Exec(ctx,
		`update repositories set is_active = $1 where id = $2`,
		body.IsActive, repoID,
	)
	if err != nil {
		http.Error(w, "failed to update repo", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GET /api/v1/me/teams — list teams for the current user
func (h *TeamHandler) ListMyTeams(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.Header.Get("X-User-ID")

	rows, err := h.DB.Query(ctx, `
		select t.id, t.name, t.slug, t.created_at
		from teams t
		join team_members tm on tm.team_id = t.id
		where tm.user_id = $1
		order by t.created_at asc
	`, userID)
	if err != nil {
		http.Error(w, "failed to fetch teams", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var teams []models.Team
	for rows.Next() {
		var t models.Team
		_ = rows.Scan(&t.ID, &t.Name, &t.Slug, &t.CreatedAt)
		teams = append(teams, t)
	}
	if teams == nil {
		teams = []models.Team{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"teams": teams,
	})
}

var nonAlphanumeric = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = nonAlphanumeric.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	// append a short timestamp to reduce collision probability
	s = s + "-" + strings.ToLower(time.Now().Format("060102"))
	return s
}
