# QA Tool Web UI

A web-based user interface for the QA Tool that allows you to run tests, manage context files, and view results through a browser.

## Features

- **Run Test Analysis**: Configure and start test runs with URL, max pages, and max actions
- **View Test Results**: Browse all test runs, view detailed results, test cases, and screenshots
- **Manage Context Files**: Create, edit, and delete context files for different domains

## Setup

### 1. Install Dependencies

```bash
# Install backend dependencies (if not already done)
npm install

# Install UI dependencies
cd ui
npm install
cd ..
```

### 2. Build the UI

```bash
cd ui
npm run build
cd ..
```

### 3. Build the Backend

```bash
npm run build
```

## Running

### Development Mode

**Terminal 1 - Backend Server:**
```bash
npm run server
```

**Terminal 2 - UI Development Server (optional, for hot reload):**
```bash
npm run ui:dev
```

The backend server runs on `http://localhost:3000` and serves the UI.

### Production Mode

1. Build both backend and UI:
```bash
npm run build
cd ui && npm run build && cd ..
```

2. Start the server:
```bash
npm run server:prod
```

Visit `http://localhost:3000` in your browser.

## API Endpoints

The server provides the following REST API endpoints:

- `GET /api/health` - Health check
- `POST /api/run-test` - Start a new test run
- `GET /api/runs` - List all test runs
- `GET /api/runs/:runId` - Get detailed results for a run
- `GET /api/runs/:runId/status` - Get run status
- `GET /api/runs/:runId/screenshots/:filename` - Get screenshot
- `GET /api/context` - List all context files
- `GET /api/context/:domain` - Get a context file
- `PUT /api/context/:domain` - Save/update a context file
- `DELETE /api/context/:domain` - Delete a context file

## Usage

1. **Run a Test**:
   - Go to the "Run Test" tab
   - Enter the website URL
   - Configure max pages and max actions
   - Click "Start Test Analysis"
   - The test will run in the background

2. **View Results**:
   - Go to the "Test Results" tab
   - See all test runs with their status
   - Click "View" to see detailed results, test cases, and screenshots

3. **Manage Context Files**:
   - Go to the "Context Files" tab
   - Create new context files for domains
   - Edit existing context files (JSON format)
   - Delete context files you no longer need

## Architecture

- **Backend**: Express.js server (`src/server.ts`) that wraps the existing CLI functionality
- **Frontend**: React app with Vite (`ui/`) that communicates with the API
- **Test Runner**: Extracted test execution logic (`src/test-runner.ts`) that can be called from both CLI and API

## Notes

- Test runs execute asynchronously - the API returns immediately with a run ID
- Check the "Test Results" tab to see progress and results
- The UI auto-refreshes every 5 seconds to show new runs and updates
- Context files are stored in the `context/` directory
- Test results are stored in the `output/` directory


