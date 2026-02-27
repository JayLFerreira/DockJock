# DockJock - Phase 1

A calorie and macro tracking web application with natural language food entry.

## Phase 1 Features
- ✅ Login system (default password: Jay1234)
- ✅ Basic home page with progress rings
- ✅ Database setup with SQLite
- ✅ Docker containerization
- ✅ Settings API endpoints
- ✅ Meal type selection (Breakfast, Lunch, Dinner, Snack, Workout Shake)

## Prerequisites

1. **Docker Desktop** installed on your PC
   - Download from: https://www.docker.com/products/docker-desktop/
   - Make sure Docker is running before deployment

## Deployment Instructions

### Step 1: Extract Files
Extract all files from the macro-tracker folder to a location on your PC (e.g., `C:\macro-tracker`)

### Step 2: Run Setup Script
1. Open Command Prompt **as Administrator** (for DNS entry)
   - Right-click Command Prompt and select "Run as administrator"
2. Navigate to the project folder:
   ```
   cd C:\macro-tracker
   ```
3. Run the setup script:
   ```
   setup.bat
   ```

### Step 3: Configure Application
The setup script will ask you for:
- **Port number** (default: 8080) - Choose a port not already in use
- **OpenAI API Key** - Your OpenAI API key (get one from https://platform.openai.com/api-keys)
- **OpenAI Model** (default: gpt-4o-mini) - Can use gpt-4.1-mini if available
- **Admin Password** (default: Jay1234) - Your login password

### Step 4: Wait for Build
Docker will build and start the containers. This may take a few minutes the first time.

### Step 5: Access the App
Once complete, open your browser and go to:
```
http://dockjock:8080
```
OR
```
http://localhost:8080
```
(Replace 8080 with whatever port you chose)

**Note:** The `dockjock` URL only works if you ran setup.bat as Administrator. If not, use `localhost` or run `add-dns.bat` as Administrator to add the DNS entry later.

## Stopping the App

To stop the app:
```
docker-compose down
```

## Starting the App Again

After initial setup, just run:
```
docker-compose up -d
```

## Troubleshooting

### Port Already in Use
If you get a port conflict error:
1. Stop the containers: `docker-compose down`
2. Edit the `.env` file and change the PORT value
3. Restart: `docker-compose up -d`

### Can't Access the App
1. Make sure Docker Desktop is running
2. Check if containers are running: `docker ps`
3. Check logs: `docker-compose logs`

### DNS Entry Not Working
If `http://dockjock:8080` doesn't work:
1. Make sure you ran `setup.bat` as Administrator
2. OR run `add-dns.bat` as Administrator
3. Verify the entry exists in `C:\Windows\System32\drivers\etc\hosts`
4. You should see: `127.0.0.1 dockjock`
5. If still not working, use `http://localhost:8080` instead

### Login Not Working
- Default password is `Jay1234` (or whatever you set during setup)
- Password is case-sensitive

## What's Working in Phase 1
- ✅ Login/logout functionality
- ✅ Beautiful progress rings UI
- ✅ Meal type selection
- ✅ Food entry form (UI only - OpenAI integration in Phase 2)
- ✅ Navigation between pages
- ✅ Persistent data storage

## Coming in Phase 2
- OpenAI API integration for natural language food parsing
- Display today's food entries
- Update progress rings with real data
- Add/edit/delete entries

## File Structure
```
macro-tracker/
├── backend/
│   ├── main.py          # FastAPI application
│   ├── database.py      # Database models
│   ├── requirements.txt # Python dependencies
│   └── Dockerfile       # Backend container config
├── frontend/
│   ├── index.html       # Main HTML
│   ├── styles.css       # Styles
│   ├── app.js           # JavaScript logic
│   ├── nginx.conf       # Nginx config
│   └── Dockerfile       # Frontend container config
├── data/                # SQLite database (created on first run)
├── docker-compose.yml   # Multi-container orchestration
├── setup.bat            # Windows setup script
└── .env                 # Configuration (created by setup.bat)
```
