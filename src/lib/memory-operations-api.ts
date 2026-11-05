import { z } from "zod";
import {
  SessionSchema,
  SessionCreateSchema,
  SessionUpdateSchema,
  WebhookSchema,
  WebhookWriteSchema,
  WebhookTestSchema,
  WebhookTestResultSchema,
  WebhookDeliverySchema,
  WebhookDeliveriesSchema,
  GraphSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  MemoryOperationSchema,
  MemoryRecordSchema,
  MemoryQueueStatusSchema,
  MemoryQueueJobSchema,
  SessionContextRequestSchema,
  SessionContextResultSchema,
  SessionChatRequestSchema,
  SessionChatResultSchema,
  ConsolidationRequestSchema,
  ConflictResolveSchema,
  type SessionCreate,
  type SessionUpdate,
  type WebhookWrite,
  type WebhookTest,
  type ConsolidationRequest,
} from "../../contracts/hivemem.generated";
import { memoryRequest } from "./memory-api";
const id = (value: string) => encodeURIComponent(value);
const query = (values: Record<string, string | number>) =>
  new URLSearchParams(
    Object.entries(values).map(([key, value]) => [key, String(value)]),
  ).toString();
const object = async (path: string, method = "GET", body?: object) =>
  MemoryOperationSchema.parse(await memoryRequest(path, method, body));
export const memoryOperations = {
  sessions: async (workspace: string) =>
    z
      .array(SessionSchema)
      .parse(
        await memoryRequest("/sessions?" + query({ workspace_id: workspace })),
      ),
  session: async (value: string) =>
    SessionSchema.parse(await memoryRequest("/sessions/" + id(value))),
  createSession: async (body: SessionCreate) =>
    SessionSchema.parse(
      await memoryRequest("/sessions", "POST", SessionCreateSchema.parse(body)),
    ),
  updateSession: async (value: string, body: SessionUpdate) =>
    SessionSchema.parse(
      await memoryRequest(
        "/sessions/" + id(value),
        "PUT",
        SessionUpdateSchema.parse(body),
      ),
    ),
  deleteSession: async (value: string) => {
    await memoryRequest("/sessions/" + id(value), "DELETE");
  },
  sessionMemories: async (value: string) =>
    z
      .array(MemoryRecordSchema)
      .parse(await memoryRequest("/sessions/" + id(value) + "/memories")),
  sessionContext: async (value: string, workspace: string, text: string) =>
    SessionContextResultSchema.parse(await memoryRequest("/sessions/" + id(value) + "/context", "POST", SessionContextRequestSchema.parse({
      workspace_id: workspace,
      search_query: text,
    }))),
  sessionChat: async (value: string, workspace: string, text: string) =>
    SessionChatResultSchema.parse(await memoryRequest("/sessions/" + id(value) + "/chat", "POST", SessionChatRequestSchema.parse({
      workspace_id: workspace,
      query: text,
      stream: false,
    }))),
  webhooks: async (workspace: string) =>
    z
      .array(WebhookSchema)
      .parse(
        await memoryRequest("/webhooks?" + query({ workspace_id: workspace })),
      ),
  webhook: async (value: string) =>
    WebhookSchema.parse(await memoryRequest("/webhooks/" + id(value))),
  createWebhook: async (body: WebhookWrite) =>
    WebhookSchema.parse(
      await memoryRequest("/webhooks", "POST", WebhookWriteSchema.parse(body)),
    ),
  updateWebhook: async (value: string, body: WebhookWrite) =>
    WebhookSchema.parse(
      await memoryRequest(
        "/webhooks/" + id(value),
        "PUT",
        WebhookWriteSchema.parse(body),
      ),
    ),
  deleteWebhook: async (value: string) =>
    WebhookSchema.parse(
      await memoryRequest("/webhooks/" + id(value), "DELETE"),
    ),
  testWebhook: async (body: WebhookTest) =>
    WebhookTestResultSchema.parse(
      await memoryRequest(
        "/webhooks/test",
        "POST",
        WebhookTestSchema.parse(body),
      ),
    ),
  deliveries: async (workspace: string, offset: number) =>
    WebhookDeliveriesSchema.parse(
      await memoryRequest(
        "/webhooks/deliveries?" +
          query({ workspace_id: workspace, limit: 25, offset }),
      ),
    ),
  delivery: async (value: string) =>
    WebhookDeliverySchema.parse(
      await memoryRequest("/webhooks/deliveries/" + id(value)),
    ),
  graph: async (
    workspace: string,
    anchor: string,
    anchorKind: "memory_id" | "entity_id",
  ) =>
    GraphSchema.parse(
      await memoryRequest(
        "/graph/neighborhood?" +
          query({
            workspace_id: workspace,
            ...(anchor ? { [anchorKind]: anchor } : {}),
            limit: 80,
          }),
      ),
    ),
  graphEntities: async (workspace: string) =>
    z
      .array(GraphNodeSchema)
      .parse(
        await memoryRequest(
          "/graph/entities?" + query({ workspace_id: workspace }),
        ),
      ),
  graphRelations: async (workspace: string) =>
    z
      .array(GraphEdgeSchema)
      .parse(
        await memoryRequest(
          "/graph/relations?" + query({ workspace_id: workspace }),
        ),
      ),
  graphEntity: (value: string, workspace: string) =>
    object(
      "/graph/entities/" + id(value) + "?" + query({ workspace_id: workspace }),
    ),
  conflicts: (workspace: string) =>
    object("/conflicts?" + query({ workspace_id: workspace })),
  resolveConflict: (value: string, action: "acknowledge" | "dismiss") =>
    object(
      "/conflicts/" + id(value) + "/resolve",
      "POST",
      ConflictResolveSchema.parse({ action }),
    ),
  consolidationStatus: (workspace: string) =>
    object("/consolidation/status?" + query({ workspace_id: workspace })),
  consolidationLogs: (workspace: string) =>
    object("/consolidation/logs?" + query({ workspace_id: workspace })),
  consolidationLog: (value: string) =>
    object("/consolidation/logs/" + id(value)),
  consolidate: (body: ConsolidationRequest) =>
    object(
      "/memories/consolidate",
      "POST",
      ConsolidationRequestSchema.parse(body),
    ),
  queue: async (workspace: string, offset: number, status: string) =>
    MemoryQueueStatusSchema.parse(await memoryRequest(
      "/queue/status?" +
        query({
          workspace_id: workspace,
          offset,
          limit: 25,
          ...(status ? { status } : {}),
        }),
    )),
  job: async (value: string) => MemoryQueueJobSchema.parse(await memoryRequest("/queue/jobs/" + id(value))),
  runJob: async (value: string) =>
    MemoryQueueJobSchema.parse(await memoryRequest("/queue/jobs/" + id(value) + "/run", "POST", {})),
  retryJob: async (value: string) =>
    MemoryQueueJobSchema.parse(await memoryRequest("/queue/jobs/" + id(value) + "/retry", "POST", {})),
  cancelJob: async (value: string) => MemoryQueueJobSchema.parse(await memoryRequest("/queue/jobs/" + id(value), "DELETE")),
  runNext: async (workspace: string) =>
    MemoryQueueJobSchema.parse(await memoryRequest("/queue/run-next?" + query({ workspace_id: workspace }), "POST", {})),
  operation: async (value: string, workspace: string) =>
    MemoryQueueJobSchema.parse(await memoryRequest(
      "/queue/operations/" +
        id(value) +
        "?" +
        query({ workspace_id: workspace }),
    )),
};
