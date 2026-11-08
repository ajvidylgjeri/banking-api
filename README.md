# Banking System Backend API

Express + MySQL + JWT. Roles: **customer** and **admin** (bank manager).

## Setup

```bash
npm install
cp .env.example .env        # then edit DB_PASSWORD and JWT_SECRET
mysql -u root -p < sql/schema.sql
npm run seed:admin          # creates the first admin from ADMIN_* in .env
npm start                   # or: npm run dev
```
Requires Node 18+ and MySQL 8.0.16+ (CHECK constraints). Send the token as `Authorization: Bearer <token>`.
Passwords are hashed with bcrypt (bcryptjs); auth uses JWT; every error is JSON `{ "error": "..." }`.

Run `npm run seed:admin` after the schema is loaded. Public signup can only create customers.

## Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| POST | /signup, /login | public | Auth (bcrypt + JWT) |
| POST | /account/create | customer | `{account_type: savings\|current}` – 10-digit number auto-generated |
| GET | /account/me | customer | My account(s): number, holder, email, type, **balance** |
| GET | /account/:id | admin | Any account |
| POST | /deposit | customer | `{account_number?, amount}` |
| POST | /withdraw | customer | `{account_number?, amount}` |
| POST | /transfer | customer | `{from_account?, to_account, amount}` |
| GET | /transactions | customer | Own history: `?type=&from=YYYY-MM-DD&to=YYYY-MM-DD&account_number=&page=&limit=` |
| GET | /transactions/:accountId | admin | History of any account |
| GET | /admin/users · /admin/accounts · /admin/transactions | admin | Paginated lists |
| PUT | /admin/accounts/:id/block · /unblock | admin | Block/unblock account (optional feature) |

`account_number` may be omitted when the customer has only one account.

## Security & integrity
- bcrypt password hashing, JWT auth, role-based route protection, public signup can never create an admin.
- **Overdraft prevention** twice: atomic `UPDATE … WHERE balance >= amount` and a DB `CHECK (balance >= 0)`.
- Every money movement is a **DB transaction** with row locks (`SELECT … FOR UPDATE`, accounts locked in id order to avoid deadlocks), so balances and the transaction log never disagree.
- Amount validation: positive, ≤ 2 decimals, ≤ 1,000,000; blocked accounts can't send or receive.
- Bonus: daily debit limit per account (`DAILY_LIMIT`, default 50,000).
- `transactions.from_account` is the account acted on: deposits/withdrawals have `to_account = NULL`; `type` gives the direction.
