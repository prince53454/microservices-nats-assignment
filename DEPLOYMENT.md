# Deployment Guide — Hybrid: Vercel Gateway + Railway Services

This project deploys as a **hybrid**, and that is deliberate:

| Component | Platform | Why |
|---|---|---|
| API Gateway | **Vercel** (serverless) | Pure stateless HTTP: verify JWT, proxy, respond. The ideal serverless workload. |
| User Service | **Railway** (container) | Long-running process holding a MongoDB connection pool. |
| Notification Service | **Railway** (container) | Runs a **persistent JetStream consumer** — it must stay connected to NATS 24/7. Serverless would kill it between requests and events would pile up unprocessed. |
| MongoDB | **MongoDB Atlas** (free M0 tier) | One cluster, two databases (`users`, `notifications`). |
| NATS | **Railway template** (`nats:2.10`) | Needs `-js` (JetStream) and auth; configured via a start command. |

> **Interview soundbite:** "I deployed the gateway to serverless because it's
> stateless request/response, but the event consumer must be a long-lived
> process — serverless functions suspend when idle and a durable consumer
> would stop receiving. That's why the hybrid."

If you'd rather keep it simple, deploying **everything** on Railway with the
existing `docker-compose.yml` semantics is a perfectly valid alternative.

---

## 0. Prerequisites

- GitHub repo pushed (see step 5 of the README for `git init` + first push).
- Accounts: [Vercel](https://vercel.com), [Railway](https://railway.app), [MongoDB Atlas](https://cloud.mongodb.com).
- Railway CLI (optional but handy): `npm i -g @railway/cli`

## 1. MongoDB Atlas (≈5 min)

1. Create a free **M0** cluster.
2. **Database Access** → add user `app` with a strong password.
3. **Network Access** → allow `0.0.0.0/0` (Railway/Vercel egress IPs are dynamic; the DB is still protected by credentials).
4. Create two databases: `users` and `notifications`.
5. Copy the connection string, e.g.
   `mongodb+srv://app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   (you'll append the db name per service below).

## 2. NATS on Railway (≈5 min)

1. Railway → **New Project** → empty.
2. **New** → **Docker Image** → `nats:2.10-alpine`.
3. In the service's **Settings → Deploy → Custom Start Command**:
   ```
   nats-server -js --store_dir /data --user appuser --pass <YOUR_NATS_PASSWORD>
   ```
   (The compose stack uses the `nats/nats.conf` file; on Railway the flags are simpler.)
4. Add a volume: mount `/data` (persistent JetStream storage).
5. **Settings → Networking → Generate Domain** (public TCP proxy) — note the host
   and port, e.g. `clientId=xxx.hosts.taurus.aws...` style; Railway gives you
   something like `nats-proxy.railway.internal:4222` private and a public
   `xxx.up.railway.app:PORT` mapping. Use the **private** one from other
   Railway services.
6. Alternative: search the templates for "NATS" — some include JetStream + auth knobs.

## 3. User Service on Railway (≈10 min)

1. In the same project: **New → GitHub Repo** → pick this repository.
2. Leave **Root Directory at the repo root** — the Dockerfiles build from the
   repo root so they can `COPY shared/` alongside the service.
3. In **Settings → Build**, set the env var / build config so Railway uses our
   Dockerfile:
   ```
   RAILWAY_DOCKERFILE_PATH=user-service/Dockerfile
   ```
   (Railway then runs `docker build -f user-service/Dockerfile .` from the
   repo root — exactly how `docker-compose.yml` builds it.)
4. Variables:
   ```
   NODE_ENV=production
   JWT_SECRET=<same as gateway>
   MONGO_URI=mongodb+srv://app:<password>@cluster0.xxxxx.mongodb.net/users
   NATS_URL=nats://<railway-nats-private-host>:4222
   NATS_USER=appuser
   NATS_PASSWORD=<YOUR_NATS_PASSWORD>
   INTERNAL_API_KEY=<generate: openssl rand -hex 32>
   LOG_LEVEL=info
   ```
5. **Settings → Networking → Generate Domain** (public, for the gateway).
   Note: `https://user-service-production-xxxx.up.railway.app`.
6. Healthcheck: Railway pings `/health` automatically if configured — the app
   exposes `/health` (liveness) and `/ready` (Mongo check).

## 4. Notification Service on Railway (≈10 min)

Same as step 3, with:
- `RAILWAY_DOCKERFILE_PATH=notification-service/Dockerfile`
- `MONGO_URI=...mongodb.net/notifications`
- Same `NATS_*` values and the **same** `INTERNAL_API_KEY`.
- Restart policy: on-failure (default). The consumer reconnects automatically.

## 5. API Gateway on Vercel (≈10 min)

1. Vercel → **Add New → Project** → import the same GitHub repo.
2. Vercel reads `vercel.json` at the repo root: it routes **all** traffic to
   `api-gateway/api/index.js` (serverless function built by `@vercel/node`).
3. Set **Root Directory** in Vercel's build settings — leave it at the repo
   root so `vercel.json` and `shared/` are visible; the build only bundles
   what `api/index.js` requires.
4. Environment Variables:
   ```
   JWT_SECRET=<same as user-service>
   USER_SERVICE_URL=https://user-service-production-xxxx.up.railway.app
   NOTIFICATION_SERVICE_URL=https://notification-service-production-xxxx.up.railway.app
   INTERNAL_API_KEY=<same value as on Railway>
   TRUST_PROXY=2
   CORS_ORIGIN=https://your-frontend.vercel.app   # or * for the demo
   RATE_LIMIT_MAX=100
   LOG_LEVEL=info
   ```
5. Deploy. Your public URL: `https://<project>.vercel.app`.
6. Vercel's default function timeout (10s Hobby) is fine — the gateway's own
   upstream timeout is 10s; consider lowering `PROXY_TIMEOUT_MS` to 8000.

## 6. Verify the deployment

```bash
GW=https://<project>.vercel.app

# 1. Health
curl -s $GW/health

# 2. Register (async event fires; welcome notification appears in ~2s)
curl -s -X POST $GW/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Vishwajeet","email":"you@example.com","password":"supersecret1"}'
# -> save the JWT from the response

# 3. Notifications (wait ~2s after registering)
curl -s $GW/api/notifications -H "Authorization: Bearer <JWT>"

# 4. Negative test: direct access to a backend service must 401
#    (INTERNAL_API_KEY gate working)
curl -s https://user-service-production-xxxx.up.railway.app/users/me
# -> {"success":false,"error":{"code":"UNAUTHORIZED",...}}
```

Also open `https://<project>.vercel.app/api/docs` — the Swagger UI "Try it out"
works against your deployed gateway (the spec uses a relative server URL).

## 7. Costs (free-tier friendly)

- Vercel Hobby: free.
- Railway: trial credit; after that ~$5/mo for 2 small services + NATS.
- Atlas M0: free forever.

## 8. Known trade-offs (mention these in the interview)

1. **Gateway → services is HTTPS over the public internet** between Railway
   and Vercel. Mitigations already in place: JWT verified at the gateway,
   `INTERNAL_API_KEY` gate on services, TLS everywhere. A production upgrade
   would put the gateway inside the same private network (e.g. Railway
   private networking) — that's exactly what `docker-compose` models locally.
2. **Serverless cold starts** add ~200–500ms on the first request.
3. **In-memory rate limiting** resets per lambda instance; on serverless you'd
   move to `rate-limiter-flexible`'s Redis/Atlas-backed limiter for a true
   global limit.
