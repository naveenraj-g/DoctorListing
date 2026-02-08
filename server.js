import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const WIDGET_PATH = join(process.cwd(), "public", "doctor-widget.html");

const searchInputSchema = {
  npi: z.string().min(1).optional(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  organization_name: z.string().min(1).optional(),
  taxonomy_description: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(2).max(2).optional(),
  postal_code: z.string().min(3).optional(),
  enumeration_type: z.enum(["NPI-1", "NPI-2"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  skip: z.number().int().min(0).max(1000).optional(),
};

const createDoctorServer = () => {
  const server = new McpServer({
    name: "doctor-search",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    "doctor-search-widget",
    "ui://doctor-search",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://doctor-search",
          mimeType: RESOURCE_MIME_TYPE,
          text: readFileSync(WIDGET_PATH, "utf-8"),
        },
      ],
    })
  );

  registerAppTool(
    server,
    "search_doctors",
    {
      title: "Search doctors",
      description: "Search the NPI registry for doctors or organizations.",
      inputSchema: searchInputSchema,
      _meta: {
        ui: { resourceUri: "ui://doctor-search" },
      },
    },
    async (args) => {
      const hasQuery = Object.entries(args).some(([, value]) => value);
      if (!hasQuery) {
        return {
          content: [
            {
              type: "text",
              text: "Please provide at least one search field.",
            },
          ],
          structuredContent: {
            results: [],
            result_count: 0,
            query: args,
          },
        };
      }

      const url = new URL("https://npiregistry.cms.hhs.gov/api/");
      url.searchParams.set("version", "2.1");

      const params = {
        number: args.npi,
        first_name: args.first_name,
        last_name: args.last_name,
        organization_name: args.organization_name,
        taxonomy_description: args.taxonomy_description,
        city: args.city,
        state: args.state,
        postal_code: args.postal_code,
        enumeration_type: args.enumeration_type,
        limit: args.limit?.toString(),
        skip: args.skip?.toString(),
      };

      Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
      });

      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        throw new Error(`NPI registry error: ${response.status}`);
      }
      const data = await response.json();

      const results = (data.results || []).map((entry) => {
        const basic = entry.basic || {};
        const addresses = entry.addresses || [];
        const taxonomies = entry.taxonomies || [];
        const location =
          addresses.find((address) => address.address_purpose === "LOCATION") ||
          addresses[0] ||
          {};
        const taxonomy =
          taxonomies.find((item) => item.primary) || taxonomies[0] || {};

        const name =
          entry.enumeration_type === "NPI-1"
            ? [basic.first_name, basic.last_name].filter(Boolean).join(" ")
            : basic.organization_name;

        const addressParts = [
          location.address_1,
          location.address_2,
          location.city,
          location.state,
          location.postal_code,
        ].filter(Boolean);

        return {
          npi: entry.number,
          type: entry.enumeration_type,
          name: name || "Unknown",
          specialty: taxonomy.desc || "",
          address: addressParts.join(", "),
          phone: location.telephone_number || "",
        };
      });

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} result(s).`,
          },
        ],
        structuredContent: {
          results,
          result_count: data.result_count ?? results.length,
          query: args,
        },
      };
    }
  );

  return server;
};

http
  .createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const MCP_PATH = "/mcp";
    const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

    if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
        "Access-Control-Allow-Headers": "content-type, mcp-session-id",
        "Access-Control-Expose-Headers": "Mcp-Session-Id",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Doctor Search MCP server is running.");
      return;
    }

    if (req.method === "GET" && url.pathname === "/public/doctor-widget.html") {
      try {
        const html = readFileSync(WIDGET_PATH, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Unable to load widget.");
      }
      return;
    }

    if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      const server = createDoctorServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.writeHead(500).end("Internal server error");
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  })
  .listen(PORT, () => {
    console.log(`Doctor Search MCP server listening on http://localhost:${PORT}/mcp`);
  });
