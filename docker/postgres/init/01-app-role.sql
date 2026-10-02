-- Least-privilege runtime role for local development (docs/03 §20).
-- The initial migration grants table privileges to the NOLOGIN group role `proofline_app`;
-- the API connects as `proofline_app_user`, a member of that role.
-- Development-only password; never reuse outside local Docker.
CREATE ROLE proofline_app NOLOGIN;
CREATE ROLE proofline_app_user LOGIN PASSWORD 'proofline_app_dev' IN ROLE proofline_app;
