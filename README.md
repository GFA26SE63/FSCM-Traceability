# FSCM Traceability

Mini ERP traceability for inbound warehouse operations that integrates with FSCM.

## Layout

- `backend/`: .NET clean-architecture API scaffold.
- `frontend/`: React/Vite feature-oriented portal scaffold.

## Local connection

Start the API on `http://localhost:5080`, then start the portal on `http://localhost:5173`.
The portal reads `VITE_TRACEABILITY_API_BASE_URL` (defaults to `http://localhost:5080`) and checks `GET /health`.

Inbound-receipt domain behavior, database schema, FSCM authentication, and integration contracts are intentionally not implemented yet.

