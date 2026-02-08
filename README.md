# Doctor Search ChatGPT Native App

A ChatGPT native app that searches the NPPES NPI Registry and renders results in a lightweight widget.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run the MCP server:

```bash
npm start
```

3. Register the app in ChatGPT:

- MCP server URL: `http://localhost:3000/mcp`
- UI resource: `ui://doctor-search`

## Tools

- `search_doctors`: Query the NPI registry with name, specialty, location, or NPI.

## Notes

- The UI uses system fonts and a minimal palette to align with ChatGPT native app UI guidance.
- Results come from the public NPI Registry API (version 2.1).
