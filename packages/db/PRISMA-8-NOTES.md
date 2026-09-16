# Prisma 8 Field Notes

Prisma 8 (rc.11), Postgres target. Written against `packages/db` in this monorepo, so the
paths and model names are the real ones. Run every command from `packages/db`, where
`prisma.config.ts` lives.

**Where this project stands:** the contract at `src/prisma/contract.prisma` declares `User`
and `Todo`, the artifacts are emitted, `db.ts` is wired. The Docker database is empty, so the
one command left is `bunx prisma db init`.

---

## The one idea behind the rename

Prisma 8 is **contract-first**. You describe your tables in one file — the **contract** — and
everything else is derived from it: your TypeScript types, your migrations, and the check that
your database still matches your code.

The schema language is the same one you already know. What changed is the name of the file,
the names of the commands, and how you reach the client in code. That's most of the confusion.

---

## Five words to learn

| Word | Meaning |
| --- | --- |
| **contract** | Your schema. `src/prisma/contract.prisma`. Same syntax as the old `schema.prisma` — models, fields, `@id`, `@relation`, all unchanged. |
| **emit** | Reading the contract and writing out `contract.json` (runtime) and `contract.d.ts` (types). The new `generate`. Never hand-edit those two files. |
| **marker** | A stamp Prisma keeps inside your database, in a table called `prisma_contract.marker`. Records which contract version this database was built from, so Prisma can tell when the two drift apart. |
| **drift** | Database and contract disagree. Either the database is behind (migrate) or the contract is behind (fix it, then re-stamp). |
| **db ref** | A note on disk at `migrations/app/refs/db.json` remembering how far your local dev database was taken. Lets Prisma plan a migration without connecting. You rarely touch it. |

---

## Old command → new command

| You used to type | Now type | What it does |
| --- | --- | --- |
| `schema.prisma` | `src/prisma/contract.prisma` | Your schema file |
| `prisma generate` | `prisma contract emit` | Rebuild types after a schema edit |
| `prisma db push` | `prisma db update` | Shove the schema straight into a dev database |
| `prisma migrate dev` | `prisma migration plan --name x` | Write a migration file |
| `prisma migrate deploy` | `prisma db migrate` | Apply pending migrations |
| `prisma db pull` | `prisma contract infer` | Build a contract from tables that already exist |
| `prisma studio` | `prisma db schema` | No GUI yet — prints the live schema as a tree |
| `new PrismaClient()` | `import { db } from './prisma/db'` | Your client, already written for you |
| `prisma.user.findMany()` | `db.orm.public.User.all()` | A query. `public` is the Postgres schema name |

**Run the project's own version.** Use `bunx prisma …`, not `bunx prisma@latest …`. The second
downloads a different version than the one in `package.json`, and the two can disagree about
your files.

---

## Starting a database from zero

Each step depends on the one above it.

### 1. Run Postgres

Postgres 16 keeps its data in `/var/lib/postgresql/data`. Mount the volume anywhere else and
your tables vanish with the container.

```bash
docker run -d --name deploy-monorepo \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=mydb \
  -v volume-db:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16-alpine
```

`POSTGRES_DB` has to match the database name at the end of your `DATABASE_URL`. These three
variables only apply the first time a volume is created — on an old volume they are ignored.

### 2. Point the app at it

`packages/db/.env` holds the connection string. Nothing else should — never put it in
`prisma.config.ts`.

```
DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
```

### 3. Emit, if you touched the contract

Safe to run any time.

```bash
bunx prisma contract emit
```

### 4. Create the tables

Builds every table, index and foreign key from the contract, then writes the marker. The
one-time command for an empty database.

```bash
bunx prisma db init
```

### 5. Round-trip one row

Prove the chain works before writing app code. `bunx tsx src/check.ts`

```ts
// src/check.ts
import { db } from './prisma/db';

await db.orm.public.User.create({ username: 'yash', password: 'hashed' });

const users = await db.orm.public.User.select('id', 'username').all();
console.log(users);

await db.close(); // scripts hang without this
```

---

## The loop you'll actually live in

Editing `contract.prisma` changes nothing on its own. **emit** updates your types, then one of
two paths updates the database.

### While building locally

Fast, writes no migration files. Only ever against your own Docker database.

```bash
bunx prisma contract emit
bunx prisma db update --dry-run   # see the plan first
bunx prisma db update
```

If the change would drop a column or table, it stops and asks you to type the database name
back (`mydb`) first.

### When the change has to ship

Writes a reviewable migration folder under `migrations/app/` that you commit to git. Use this
for anything shared or deployed.

```bash
bunx prisma contract emit
bunx prisma migration plan --name add_todo_due_date
bunx prisma migration show <folder-name>    # read it before applying
bunx prisma db migrate
```

- **Two folders on your first plan is normal.** If you iterated with `db update` first, the
  first `migration plan` writes a baseline folder plus your actual change. Commit both.
- **Never `db update` a shared or production database.** It leaves no history, so nobody can
  replay what you did. It also refuses outright when a change needs data moved around — that
  only works on the migration path.

---

## Which of init, update and sign?

All three end with database and contract agreeing. They differ in what they may change.

| Situation | Command | What it changes |
| --- | --- | --- |
| Empty database, contract ready | `db init` | Creates the tables, writes the marker |
| Tables exist, contract changed | `db update` | Alters the tables, moves the marker |
| Tables already match the contract exactly | `db sign` | Marker only. Creates nothing |
| Tables exist, no contract yet | `contract infer` | Writes a contract from the live tables |
| Just want to know if things match | `db verify` | Nothing. Read-only check |

This is why `db sign` failed: it refuses to stamp a database whose tables don't already match.
It's for adopting an existing database, not building one.

---

## Queries, side by side

The ORM lane covers ordinary work. Note the `public` in every path — the Postgres schema, and
on Postgres it's never optional.

```ts
import { db } from './prisma/db';

// findUnique → .first({ pk })
const user = await db.orm.public.User.first({ id });

// findFirst with a filter → a lambda over the fields
const yash = await db.orm.public.User
  .where((u) => u.username.eq('yash'))
  .first();

// findMany + select + orderBy + take
const todos = await db.orm.public.Todo
  .where({ done: false })          // object form = equality
  .select('todoId', 'task')
  .orderBy((t) => t.task.asc())
  .limit(20)
  .all();

// include — the callback shapes the branch
const withTodos = await db.orm.public.User
  .select('id', 'username')
  .include('todos', (t) => t.where({ done: false }).limit(5))
  .all();

// create / update / delete — all return the affected rows
await db.orm.public.Todo.create({ task: 'ship it', userId: user.id });
await db.orm.public.Todo.where({ todoId }).update({ done: true });
await db.orm.public.Todo.where({ todoId }).delete();

// count is not a terminal — it's an aggregate
const { open } = await db.orm.public.Todo
  .where({ done: false })
  .aggregate((a) => ({ open: a.count() }));

// $transaction → db.transaction
await db.transaction(async (tx) => {
  const u = await tx.orm.public.User.create({ username, password });
  await tx.orm.public.Todo.create({ task: 'first', userId: u.id });
});
```

- Field operators: `.eq` `.neq` `.lt` `.lte` `.gt` `.gte` `.like` `.ilike` `.in([…])`
  `.isNull()`. There is no `.between()` — chain two `.where()` calls.
- `and`, `or`, `not` are imported from `@prisma/orm-postgres/orm-client`.
- `await` on `.all()` gives a plain array. Don't await the same result twice — it can only be
  consumed once.
- When the ORM can't express the shape (real joins, computed columns), drop to
  `db.sql.public.todo`, which builds a plan you run with `db.runtime().query(plan)`.

---

## Errors, decoded

Every Prisma 8 error carries a code, a *why*, and a *fix*. The ones you'll hit first:

| Code | It means | Do this |
| --- | --- | --- |
| `CONTRACT.SCHEMA_VERIFICATION_FAILED` | The tables listed as "missing" aren't in the database | `db init` on an empty database, or `db update` if it's partly built |
| `CONTRACT.MARKER_MISSING` | No stamp in this database yet | `db init`, or `db sign` if the tables already match |
| `CONTRACT.MARKER_MISMATCH` | Stamp and contract are different versions | Migrate forward, or `db sign` if the database is the correct side |
| `MIGRATION.DESTRUCTIVE_CHANGES` | Something would be dropped and you weren't asked | Re-run with `--confirm mydb`, or `--dry-run` to look first |
| `MIGRATION.HASH_MISMATCH` | A `migration.ts` was edited but not re-emitted | `node migrations/app/<dir>/migration.ts`, then migrate again |
| Model "X" does not exist | Types are stale | `contract emit` |

Exit codes: `0` fine, `4` ran and found a problem, `2` couldn't run at all.

---

## Things that will bite you

- **Editing the contract without emitting.** Types stay stale and the type-checker insists a
  model doesn't exist.
- **Hand-editing `contract.json` or `contract.d.ts`.** Generated files. The next emit
  overwrites you.
- **A script that never exits.** The connection pool holds the process open. End with
  `await db.close()`.
- **Renaming a field.** Prisma can't tell a rename from a delete-plus-add, so the plan comes
  out destructive. Plan the migration, then edit `migration.ts` by hand and re-run it to
  re-emit.
- **Expecting `prisma db seed`.** Doesn't exist. Write a script that imports `db` and add it to
  your `package.json` scripts.
- **Expecting Studio.** Not yet. `prisma db schema` prints the live schema instead.

---

Every command takes `--help`, and that output beats any notes — including these — when the two
disagree. The docs page for adopting an existing database uses `contract infer` + `db sign`;
that path is correct, it just isn't yours.
