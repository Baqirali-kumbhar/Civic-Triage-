# Sindh Civic Triage (SC-01) - Ajrak edition
## Run
1. Node.js 22.13+ (LTS)   2. `npm install`   3. `npm start`   4. open http://localhost:3000
Phone: same Wi-Fi, open http://LAPTOP-IP:3000, then Install app (Android) or Add to Home Screen (iPhone).

## Logins
- Administrator: admin / admin123   (full control: complaints, categories, staff, rules, delete)
- Manager / Controller: manager / manager123   (view all, assign attenders, reports)
- Field Attender: attender1 / staff123   (sees only own tasks, updates status, uploads proof)
- Citizens register themselves: name, caste, area, phone, 13-digit NIC, profile photo, password. One account per NIC, max 5 complaints per day.

## Features
Ajrak theme, live dashboard (6 charts, refresh every 6 s), popups for every action, category CRUD, staff CRUD,
auto-assign by area, duplicate ("similar attempt") detection, priority rules, PDF report (print > Save as PDF), Excel (CSV) export.
Database: SQLite file data/ajrak.db (relational tables: users, categories, departments, complaints, timeline, sessions, settings). Starts with zero complaints.
Reset data: stop the server and delete the data folder.

## New in this version
- Ajrak design from your images: maroon tile pattern for hero, sidebar and card bands; cross-stitch borders on both sides of the citizen pages (wide screens).
- Maps (Leaflet + OpenStreetMap, free, no API key): citizens tap the map or use live GPS, the address is filled automatically; Admin has a Live map tab. Every complaint also has an "Open in Google Maps" link.
- Demo data: Admin > Team & citizens > Load 50 demo records (50 citizens + complaints + 3 demo attenders). All editable/deletable; "Remove all demo data" clears them. Demo citizens log in with their NIC and password demo123.
- Maps and fonts need internet. To use Google Maps tiles later, a Google Maps API key with billing is required.

On the very first start the app loads 50 demo citizens and complaints automatically (only if the database has no complaints). Remove them anytime from Admin > Team & citizens.

## Update: accounts, email and password reset
- Registration needs: name, caste, area, email, 11-digit phone (03XXXXXXXXX) and 13-digit NIC (numbers only, no dashes), photo, password.
- One person can register once: NIC, email and phone must each be unique. Citizens log in with NIC or email. Staff can log in with username or email (admin@sindhcivic.pk).
- Forgot password: enter email or NIC, get a 6-digit code (valid 15 minutes, 5 tries), then set a new password.
  Real email: set environment variables before `npm start`: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
  Without them the app is in demo mode: the code is shown on screen and printed in the server console, for citizen accounts only.
  Do not deploy publicly without SMTP settings and NODE_ENV=production.
- Admin additions: filters (status, category, priority, sort), bulk assign / bulk status, overdue flag (days editable in Priority rules),
  citizen search and Block/Unblock, staff performance (open, resolved, average fix time), recent activity feed, new charts.
