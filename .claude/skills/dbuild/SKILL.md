---
name: dbuild
description: Rebuild and restart the DockJock Docker containers, then tail the logs to verify everything started cleanly.
user-invocable: true
---

Run the following steps in order:

1. Run `docker-compose down && docker-compose up -d --build` from the project root (`c:/Users/ferre/Documents/DockJock/dockjock-phase2-fixed (1)/macro-tracker/`).
2. Wait for the build to complete.
3. Run `docker-compose logs --tail=40` to show the last 40 lines of logs from both containers.
4. Report whether both containers started successfully (look for "Application startup complete" from the backend and no ERROR lines).
5. If there are errors, summarize them clearly so the user knows what to fix.
