/* zod DTOs for the Knowledge Vault v2 API. */
const { z } = require("zod");

const bodySchema = z
  .object({
    format: z.enum(["richtext", "markdown", "html", "plain"]).optional(),
    richText: z.any().optional(),
    markdown: z.string().optional(),
    html: z.string().optional(),
    plain: z.string().optional(),
  })
  .partial();

const referencesSchema = z
  .object({
    projects: z.array(z.string()).optional(),
    tasks: z.array(z.string()).optional(),
    employees: z.array(z.string()).optional(),
    customers: z.array(z.string()).optional(),
    vendors: z.array(z.string()).optional(),
  })
  .partial();

const createNote = z.object({
  title: z.string().max(1000).default(""),
  overview: z.string().optional(),
  content: z.string().optional(),
  body: bodySchema.optional(),
  color: z.string().max(32).optional(),
  folder: z.string().optional(),
  folderId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  status: z.enum(["draft", "active", "archived", "published"]).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  visibility: z.enum(["private", "org", "shared", "public"]).optional(),
  isPinned: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  isImportant: z.boolean().optional(),
  heroImage: z.string().optional(),
  actionItems: z.array(z.object({ text: z.string(), completed: z.boolean().default(false) })).optional(),
  notesList: z.array(z.string()).optional(),
  attachments: z.array(z.any()).optional(),
  references: referencesSchema.optional(),
  customMetadata: z.record(z.any()).optional(),
});

const updateNote = createNote.partial().extend({
  expectedVersion: z.number().optional(),
  reason: z.string().optional(),
});

const createFolder = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().nullable().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  visibility: z.enum(["private", "org", "shared"]).optional(),
});

const createCategory = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  color: z.string().optional(),
});

const createShare = z.object({
  principalType: z.enum(["user", "role", "org", "link"]),
  principalId: z.string().nullable().optional(),
  roleName: z.string().nullable().optional(),
  access: z.enum(["viewer", "commenter", "editor", "owner"]).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

module.exports = { createNote, updateNote, createFolder, createCategory, createShare };
