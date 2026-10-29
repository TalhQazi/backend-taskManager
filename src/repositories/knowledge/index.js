/* Repositories for the Knowledge Vault. NoteRepository adds a visibility-aware
 * list filter on top of the base org/soft-delete scope. */
const BaseRepository = require("./BaseRepository");
const models = require("../../models/knowledge");

class NoteRepository extends BaseRepository {
  constructor() {
    super(models.Note);
  }

  /**
   * Build the "notes I can see" filter: mine OR org-visible OR shared to me.
   * `sharedNoteIds` is resolved by the service from kv_note_shares.
   */
  visibilityFilter(ctx, sharedNoteIds = []) {
    if (["super-admin", "admin"].includes(ctx.role)) return {}; // admins see all (still soft-delete scoped)
    const or = [{ ownerId: ctx.userId }, { userId: ctx.userId }];
    if (ctx.organizationId) or.push({ organizationId: ctx.organizationId, visibility: { $in: ["org", "public"] } });
    or.push({ visibility: "public" });
    if (sharedNoteIds.length) or.push({ _id: { $in: sharedNoteIds } });
    return { $or: or };
  }
}

const noteRepository = new NoteRepository();
const folderRepository = new BaseRepository(models.Folder);
const categoryRepository = new BaseRepository(models.Category);
const tagRepository = new BaseRepository(models.Tag);
const shareRepository = new BaseRepository(models.NoteShare, { softDelete: false });
const commentRepository = new BaseRepository(models.NoteComment);
const relationshipRepository = new BaseRepository(models.NoteRelationship, { softDelete: false });
const embeddingRepository = new BaseRepository(models.NoteEmbedding, { softDelete: false });
const suggestionRepository = new BaseRepository(models.AiSuggestion, { softDelete: false });

module.exports = {
  noteRepository,
  folderRepository,
  categoryRepository,
  tagRepository,
  shareRepository,
  commentRepository,
  relationshipRepository,
  embeddingRepository,
  suggestionRepository,
};
