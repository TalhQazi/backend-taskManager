# Task Manager Panel Backend

## Setup

1. Copy env file

```bash
cp .env.example .env
```

2. Install deps

```bash
npm install
```

3. Seed default users

```bash
npm run seed
```

4. Run dev server

```bash
npm run dev
```

## Default seeded users

- admin / admin123
- manager / manager123

## API

- GET /health
- POST /api/auth/login
- CRUD: /api/tasks, /api/employees, /api/vehicles, /api/time-entries

Responses:

- List: `{ items: [...] }`
- Single: `{ item: {...} }`
- Errors: `{ error: { message: string } }`
