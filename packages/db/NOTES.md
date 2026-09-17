# Prisma 8 + Docker + VM: explained from zero

These notes assume you know nothing about Prisma. Read them top to bottom once.

---

## Part 0: Where you are right now (2026-09-17)

| Thing | Status |
|---|---|
| Postgres database on your laptop (`localhost:5432/mydb`) | Running, and the tables `User` and `Todo` exist |
| Contract file (`contract.prisma`) | Has `User` and `Todo` |
| Contract compiled (`contract.json`) | Yes, and it matches the file |
| Database matches the contract | Yes (`db verify` passed) |
| Migration files | **None yet** |
| Backend imports the database client | Yes (`import { db } from "db/client"`) |
| Backend queries | **Still broken.** They use the old `db.user...` style (see Part 6) |
| Dockerfile | **Empty** |
| Neon database | Not created yet |
| GitHub Actions workflow | Not written yet |

---

## Part 1: What problem is Prisma solving?

Your backend (TypeScript) needs to talk to Postgres (a database). Postgres only understands SQL, like:

```sql
INSERT INTO "User" (id, username, password) VALUES ('...', 'yash', '123');
```

Writing SQL by hand is error-prone. Typos aren't caught, and TypeScript doesn't know what columns exist.

**Prisma sits in the middle.** You describe your tables once, and Prisma gives you:
1. A TypeScript way to query (`db.orm.public.User.create(...)`), with autocomplete and type checking.
2. Tools to **create and change the tables** in the real database so they match your description.

---

## Part 2: The concepts, with real-life analogies

### 2.1 Contract = the blueprint of a house

`packages/db/src/prisma/contract.prisma` is where you write:

> "There should be a table `User` with `id`, `username`, `password`.
> There should be a table `Todo` with `todoId`, `task`, `done`, `userId`."

It's only a **plan on paper**. Writing it does **nothing** to the database by itself.

(In older Prisma this file was called `schema.prisma`. Prisma 8 calls it the "contract" because it's an agreement: "my code and my database both promise to look like this.")

### 2.2 Emit = turning the blueprint into a format machines can read

`contract.prisma` is written for **humans**. Your running app and your editor can't use it directly.

`bun prisma contract emit` reads it and produces two files:

| File | Who uses it | What for |
|---|---|---|
| `contract.json` | Your **running app** (loaded in `db.ts`) | So the app knows at runtime which tables and columns exist, and how to build the SQL |
| `contract.d.ts` | **TypeScript / VS Code** | So you get autocomplete, and red squiggles if you write `User.emial` |

**Why you need to "compile" it:** it's the same idea as TypeScript becoming JavaScript. The source is for you, and the output is what actually runs.
**If you edit `contract.prisma` and forget to emit:** the app and your editor keep using the **old** blueprint.

Emit only changes those 2 files. It **never touches the database**.

### 2.3 Database = the actual house

This is Postgres, with real tables and real rows (your users and todos). It exists separately from your code: on your laptop, on Neon, or on the VM.

### 2.4 Keeping them in sync = the house must match the blueprint

Your code is written against the **blueprint** (contract). If the blueprint says `Todo.done` exists but the real database has no `done` column, your query crashes at runtime.

So after every blueprint change, you must **also change the real database**. Prisma gives you two ways to do that (2.6 and 2.7).

### 2.5 Marker = a sticker on the house saying which blueprint it follows

When Prisma changes a database, it also writes a small hidden record **inside the database**:

> "This database matches contract version `3fa7cae3...`"

That's the **marker**. When your app starts, it compares:
- the version in `contract.json` (baked into your app), and
- the version on the marker (in the database).

If they don't match, or there's no marker at all, Prisma warns or errors. This protects you from running new code against an old database.

### 2.6 `db update` = a builder who looks at the blueprint and fixes the house directly

`bun prisma db update`:
1. Looks at the real database.
2. Looks at `contract.json`.
3. Works out the difference ("the `done` column is missing") and **runs the SQL right away**.
4. Updates the marker.

- **Good:** fast, with no files to manage.
- **Bad:** no record of *what* changed, so you can't replay the exact same steps on another database.
- **Use it:** on your laptop, while you're still experimenting.

### 2.7 Migration = a written renovation instruction you can hand to any builder

A migration is a **folder of files** in `packages/db/migrations/` that says:

> "Step 1: create table User. Step 2: add column done to Todo."

It's saved in git, so **every database (laptop, Neon, a teammate's) gets exactly the same changes in the same order.**

Two commands are involved:

| Command | What it does | Touches the database? |
|---|---|---|
| `bun prisma migration plan --name add_done` | Compares the new blueprint with the old one and **writes** the instruction files | **No**, it only writes files |
| `bun prisma db migrate` | Reads the instruction files and **runs the ones this database hasn't run yet**, then updates the marker | **Yes** |

- **Use it:** whenever the change has to reach a real or shared database (Neon, production).

### 2.8 Ref = a bookmark

`migrations/app/refs/db.json` is a bookmark: "my laptop database was last at contract version X". `migration plan` uses it to know **where to start comparing from**. `db init` and `db update` move this bookmark automatically. You don't need to touch it by hand.

### 2.9 `db init` = build the house from nothing

On a completely **empty** database, it creates all the tables from the contract and writes the marker. It's a one-time thing.

### 2.10 The whole picture

```
  YOU EDIT                 COMPILE                       CHANGE THE REAL DATABASE
┌────────────────┐  emit  ┌───────────────┐  db update (quick, local)   ┌──────────┐
│contract.prisma │ ─────▶ │ contract.json │ ──────────────────────────▶ │ Postgres │
│  (blueprint)   │        │ contract.d.ts │                             │ + marker │
└────────────────┘        └───────────────┘                             └──────────┘
                                 │  migration plan                            ▲
                                 ▼                                            │
                          ┌───────────────┐        db migrate (Neon / prod)   │
                          │  migrations/  │ ──────────────────────────────────┘
                          │ (instructions)│
                          └───────────────┘
```

---

## Part 3: Every command, what it changes, and when to use it

Run all of these from `packages/db`. They read `DATABASE_URL` from `packages/db/.env`, or from `--db <url>`.

| Command | Changes files? | Changes the database? | When |
|---|---|---|---|
| `bun prisma contract emit` | `contract.json`, `contract.d.ts` | No | **Every time** you edit `contract.prisma` |
| `bun prisma db init` | the bookmark | Creates all tables and the marker | Once, on an empty local database |
| `bun prisma db update` | the bookmark | Applies the differences directly | Local experimenting |
| `bun prisma db update --dry-run` | No | No (it only shows what it *would* do) | Before `db update`, to be safe |
| `bun prisma migration plan --name xyz` | Creates `migrations/...` folders | No | When a change is final and must go to Neon |
| `bun prisma db migrate` | No | Runs pending migrations and updates the marker | In CI against Neon, or locally to test |
| `bun prisma migration status` | No | No (it reads only) | "Is anything waiting to be applied?" |
| `bun prisma db verify` | No | No (it reads only) | "Does the database match my contract?" |
| `bun prisma db schema` | No | No (it reads only) | "What tables are actually in the database?" |

**Danger:** if a change would **delete data** (dropping a column or table), `db update` and `db migrate` stop and ask you to type the database name. In CI, where nobody can type, you must pass `--confirm <dbname>`. Otherwise the command fails.

---

## Part 4: Your step-by-step routine on your laptop

### When you change the data model

```bash
cd packages/db

# 1. Edit src/prisma/contract.prisma (for example, add a field)

# 2. Compile the blueprint
bun prisma contract emit

# 3. Try it on your laptop database
bun prisma db update --dry-run     # look at what it would do
bun prisma db update               # do it

# 4. Update your backend code and test it

# 5. When you're happy, write the migration for Neon
bun prisma migration plan --name add_something

# 6. Commit everything
git add src/prisma migrations
git commit -m "add something"
git push                           # this triggers CI, which migrates Neon (Part 8)
```

### The very first time (you're here now)

You have no migration files yet, so create the first one:

```bash
cd packages/db
bun prisma migration plan --name init
```

Because no migrations exist yet, Prisma writes a **baseline** migration: "create `User` and `Todo` from nothing". A fresh Neon database can then be built from zero with `db migrate`. Commit the new folders under `migrations/`.

---

## Part 5: What gets committed to git, and what doesn't

| File | Commit? | Why |
|---|---|---|
| `contract.prisma` | Yes | The source blueprint |
| `contract.json`, `contract.d.ts` | Yes | The app needs them at runtime (CI could also regenerate them) |
| `migrations/` | **Yes, always** | This is how Neon learns what to change |
| `.env` | **Never** | It contains your database password (already in `.gitignore`) |

---

## Part 6: Using it in backend code

```ts
import { db } from "db/client";          // curly braces: it's a named export

// get all users
const users = await db.orm.public.User.all();

// get one user
const user = await db.orm.public.User.where({ username: "yash" }).first();

// create a user (pass the fields directly, with no `data:` wrapper)
const newUser = await db.orm.public.User.create({ username, password });
```

- `db.orm.public.User` means: ORM → Postgres schema `public` (the default) → model `User`. The model name is spelled exactly as in the contract, with a capital U.
- **Your `index.ts` still uses `db.user.findMany()` and `db.user.create({ data })`. That's old Prisma syntax and it won't work.** Replace it with the calls above.

---

## Part 7: What happens INSIDE the Docker container

Your Docker image contains: Bun, your backend code, `packages/db` (with `db.ts` and `contract.json`), and `node_modules`.

When the container starts (`bun apps/backend/index.ts`), this happens:

```
1. index.ts runs  →  import { db } from "db/client"
2. That loads packages/db/src/prisma/db.ts
3. db.ts:
     a. import 'dotenv/config'  → looks for a .env file (there is NONE in the container, which is fine)
     b. reads process.env.DATABASE_URL  → comes from `docker run -e DATABASE_URL=...`
     c. loads contract.json  → "the blueprint my code was built with"
     d. creates the database client
4. On the first query, Prisma connects to Neon and checks the MARKER:
     "Is Neon on the same contract version as my contract.json?"
       yes → run queries normally
       no  → warning or error (this means you forgot to run migrations)
5. Express listens on port 8080
```

**Key points:**
- The container **does NOT change the database structure**. It only reads and writes rows. Migrations happen **before** the container starts (in CI, see Part 8).
- The container **must receive `DATABASE_URL`** as an environment variable. Never bake it into the image.
- **Order matters:** migrate Neon first, then start the new container. If you start the new code first, it expects columns that don't exist yet.

---

## Part 8: Your CI/CD plan, step by step, with Neon (recommended)

```
 git push
    │
    ▼
┌──────────────────── GitHub Actions runner (a temporary Linux machine) ────────────────────┐
│ 1. Check out the code                                                                      │
│ 2. bun install                                                                             │
│ 3. docker build  → image with the backend and contract.json inside                         │
│ 4. docker push   → Docker Hub                                                              │
│ 5. cd packages/db && bun prisma db migrate --db "$NEON_DIRECT_URL"                         │
│        → connects to Neon over the internet                                                │
│        → runs any migration folders Neon hasn't run yet                                    │
│        → updates the marker in Neon                                                        │
│ 6. ssh into the VM:                                                                        │
│        docker pull yourname/backend:latest                                                 │
│        docker stop backend && docker rm backend                                            │
│        docker run -d --name backend -p 8080:8080 \                                         │
│             -e DATABASE_URL="$NEON_POOLED_URL" yourname/backend:latest                     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
      VM: the new container starts → connects to Neon → marker matches → serves requests
```

**What each piece is responsible for:**

| Where | Job | Needs the Prisma CLI? |
|---|---|---|
| GitHub Actions | Build the image, **run migrations on Neon**, deploy | Yes (`bun install` gives it) |
| Neon | Stores your data safely and permanently | No |
| VM | Just runs the container | **No.** It never runs `prisma` |
| Container | Runs the app, reads and writes rows | No (only the runtime library) |

**Secrets to add in GitHub** (repo → Settings → Secrets):
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
- `NEON_DIRECT_URL`: used for migrations
- `NEON_POOLED_URL`: used by the app. In the Neon dashboard it's the one with `-pooler` in the hostname.
- `VM_HOST`, `VM_USER`, `VM_SSH_KEY`

Why two Neon URLs? Neon gives you a "pooled" address (good for an app that opens many connections) and a "direct" address (safer for migrations, which need one steady connection). If you want to keep it simple for practice, using the direct URL for both works too.

**Neon's first run:** Neon starts empty. The first `db migrate` runs your `init` baseline migration, which creates `User` and `Todo`. After that, each push only runs the new migrations. If nothing changed, `db migrate` does nothing, which is safe to run on every push.

---

## Part 9: Where does the data live? Neon vs a Docker volume on the VM

### What happens with a local Docker volume

Locally you probably run Postgres like this:
```bash
docker run -d --name pg -e POSTGRES_PASSWORD=... -p 5432:5432 \
  -v pgdata:/var/lib/postgresql/data postgres
```
The **volume** `pgdata` is a folder on your laptop's disk that Docker keeps even if the container is deleted. The data lives **on that machine only**.

### Option A: Neon (recommended for your plan)

The data lives on Neon's servers, not on the VM.

- The VM is **stateless**. You can delete it, recreate it, or run two of them, and no data is lost.
- CI can reach Neon over the internet, so **migrations run in CI** (Part 8). This is clean.
- Backups and restore are handled by Neon.
- **No volume is needed on the VM at all.** The backend container has no data to keep.
- Your local volume stays only for **local development**. Local data and Neon data are completely separate databases, so users you create locally won't appear on Neon.

### Option B: Postgres in Docker on the VM, with a volume

The data lives on the VM's disk.

```bash
# on the VM, once
docker network create app
docker volume create pgdata
docker run -d --name pg --network app --restart always \
  -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=mydb \
  -v pgdata:/var/lib/postgresql/data postgres:17
```
The backend then connects to it with `DATABASE_URL=postgresql://postgres:secret@pg:5432/mydb`. Note that the host is `pg`, the container name, because both containers are on the `app` network.

**How the pipeline changes:**
- CI **can't reach** this database (it's private inside the VM), so **migrations must run on the VM**. For example, over SSH:
  ```bash
  docker run --rm --network app -e DATABASE_URL=postgresql://postgres:secret@pg:5432/mydb \
    yourname/backend:latest sh -c "cd packages/db && bun prisma db migrate"
  ```
  For this to work, the image must include the Prisma CLI (`prisma` is a devDependency, so don't strip it out).
- Downsides:
  - If the VM dies or the disk is wiped, **the data is gone** unless you set up backups yourself (`pg_dump` on a cron job).
  - You manage Postgres upgrades yourself.
  - **Never run `docker volume rm pgdata`** or `docker compose down -v`. That deletes the data.
- Upside: it's free, and everything is in one place.

### Summary

| | Neon | Volume on the VM |
|---|---|---|
| Where the data lives | Neon cloud | VM disk |
| VM dies | Data is safe | **Data lost** (unless backed up) |
| Where migrations run | GitHub Actions | On the VM (over SSH) |
| Prisma CLI needed in the image | No | Yes |
| Setup effort | Low | Medium |
| **Pick it for your plan?** | **Yes** | Only if you want to learn about volumes |

---

## Part 10: Your to-do list, in order

1. [ ] Fix `apps/backend/index.ts` queries to the `db.orm.public.User` style (Part 6).
2. [ ] Create the first migration: `cd packages/db && bun prisma migration plan --name init`, then commit it.
3. [ ] Create a Neon project and copy the pooled and direct connection strings.
4. [ ] Test from your laptop: `bun prisma db migrate --db "<neon direct url>"`, then `bun prisma db verify --db "<neon direct url>"`.
5. [ ] Run the backend locally against Neon: `DATABASE_URL="<neon url>" bun apps/backend/index.ts`, then try `GET /users`.
6. [ ] Write `apps/backend/Dockerfile.backend` (it must copy `packages/db` too, and run `bun install` at the repo root).
7. [ ] Test locally: `docker build ...` then `docker run -e DATABASE_URL=... -p 8080:8080 ...`.
8. [ ] Set up the VM: install Docker and add your SSH key.
9. [ ] Add the GitHub secrets (Part 8).
10. [ ] Write `.github/workflows/deploy.yml`: build → push → `db migrate` → ssh deploy.
11. [ ] Push, and watch it deploy.

---

## Part 11: Common errors and what they mean

| Error | Plain meaning | Fix |
|---|---|---|
| `Cannot find module 'db/client'` | The backend can't find the db package | Run `bun install` at the repo root; in Docker, make sure `packages/db` was copied |
| `db.user is undefined` | Old Prisma syntax | Use `db.orm.public.User` |
| `reading contract marker` / `MARKER_MISSING` | Can't reach the database, OR the database was never set up by Prisma | Check `DATABASE_URL`; run `db migrate` (Neon) or `db init` (empty local database) |
| The app says the contract doesn't match | The code is newer than the database | Run migrations **before** starting the new container |
| Autocomplete doesn't show your new field | You forgot to emit | `bun prisma contract emit` |
| The database doesn't have your new column | You emitted but didn't change the database | Local: `db update`. Neon: `migration plan`, then push |
| `MIGRATION.DESTRUCTIVE_CHANGES` in CI | The change deletes data and nobody confirmed it | Add `--confirm <dbname>` (only if you're sure) |
