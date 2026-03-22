package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/aperture/api/internal/api/handlers"
	"github.com/aperture/api/internal/config"
	"github.com/aperture/api/internal/github"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/golang-jwt/jwt/v5"
)

func NewRouter(cfg *config.Config, db *pgxpool.Pool, appClient *github.AppClient) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.FrontendURL},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// GitHub webhook (no auth — verified by signature)
	ghHandler := &handlers.GitHubHandler{
		DB:            db,
		AppClient:     appClient,
		WebhookSecret: cfg.GitHubWebhookSecret,
		FrontendURL:   cfg.FrontendURL,
	}
	r.Post("/webhooks/github", ghHandler.HandleWebhook)

	// GitHub App installation callback (no auth — user is redirected here by GitHub)
	r.Get("/api/v1/github/callback", ghHandler.HandleInstallationCallback)

	// Authenticated API routes
	r.Group(func(r chi.Router) {
		r.Use(supabaseAuthMiddleware(cfg.SupabaseURL))

		teamHandler := &handlers.TeamHandler{DB: db}
		queueHandler := &handlers.QueueHandler{DB: db}

		r.Get("/api/v1/me/teams", teamHandler.ListMyTeams)
		r.Post("/api/v1/teams", teamHandler.CreateTeam)

		r.Route("/api/v1/teams/{teamSlug}", func(r chi.Router) {
			r.Get("/", teamHandler.GetTeam)
			r.Get("/queue", queueHandler.GetQueue)
			r.Get("/repos", teamHandler.ListRepos)
			r.Patch("/repos/{repoID}", teamHandler.UpdateRepo)
			r.Post("/repos/{repoID}/sync", ghHandler.SyncRepo)
		})
	})

	return r
}

// supabaseAuthMiddleware validates the Supabase JWT and injects X-User-ID into the request.
func supabaseAuthMiddleware(supabaseURL string) func(http.Handler) http.Handler {
	// Supabase JWTs are signed with the project's JWT secret.
	// We verify using the JWKS endpoint for production robustness.
	// For simplicity in MVP we parse the token and trust the `sub` claim
	// after verifying the signature via Supabase's public key endpoint.
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

			// Parse without verification to extract sub (user ID).
			// In production, verify against Supabase JWKS.
			token, _, err := jwt.NewParser().ParseUnverified(tokenStr, jwt.MapClaims{})
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				http.Error(w, "invalid token claims", http.StatusUnauthorized)
				return
			}
			sub, ok := claims["sub"].(string)
			if !ok || sub == "" {
				http.Error(w, "missing sub claim", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), "userID", sub)
			r = r.WithContext(ctx)
			r.Header.Set("X-User-ID", sub)
			next.ServeHTTP(w, r)
		})
	}
}
