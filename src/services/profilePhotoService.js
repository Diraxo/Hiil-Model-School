// Profile-photo Storage service — the single secure path for EVERY role's profile photo (Owner,
// Educational Director, Finance Director, Admin, Teacher, Parent, Other Staff).
//
// The bytes live in the private `profile-photos` bucket; Postgres (`profiles.photo_url` and/or
// `staff.photo_url`) stores only the object PATH `<owner_id>/<file>`, where <owner_id> is the
// person's `profiles.id` (= auth.uid) when they have a login account, or their `staff.id` when the
// staff record has no account (Other Staff). Object RLS (20260827010000 + 20260905000000) mirrors
// the `profiles` table policy: self, Owner, or a manager of that person's staff group.
//
// `applyChange` is the one helper every write path calls (AuthContext.updateOwnProfile,
// teacherService/staffService/studentService via DataContext). It takes the new form value —
// a File (new upload), null (remove), or an unchanged string — plus the previously-stored path,
// and returns the value to persist, cleaning up the old object on replace/remove and rolling the
// new object back if the caller's DB write then fails (caller signals that via `onPersisted`).
import {
  isStoragePath, signPaths, uploadObject, removeObjects, validateImageFile,
} from "../lib/storageMedia";

const BUCKET = "profile-photos";

export function createProfilePhotoService() {
  return {
    async signedUrls(paths) {
      return signPaths(BUCKET, paths);
    },

    // Resolve a form value into the string to store in the DB.
    //   value: File  -> validate, upload to <ownerId>/..., (best-effort) delete previousPath, return new path
    //   value: null  -> delete previousPath if it was an object, return null
    //   value: string / undefined / unchanged -> return it as-is (no Storage work)
    // `previousPath` is whatever is currently persisted (may be a path, a legacy data URI, or null).
    async applyChange(ownerId, value, previousPath) {
      if (value instanceof File) {
        const invalid = validateImageFile(value);
        if (invalid) throw new Error(invalid);
        const path = await uploadObject(BUCKET, ownerId, value);
        if (isStoragePath(previousPath) && previousPath !== path) {
          await removeObjects(BUCKET, previousPath);
        }
        return path;
      }
      if (value === null) {
        if (isStoragePath(previousPath)) await removeObjects(BUCKET, previousPath);
        return null;
      }
      // A string: only a real object path is persisted. A signed https URL / blob: / data: value
      // reaching here means "unchanged" (the UI handed back what it was displaying) -- keep the
      // previously-stored path rather than writing a soon-to-expire URL into the column.
      if (typeof value === "string") return isStoragePath(value) ? value : (previousPath || null);
      return previousPath || null;
    },

    // Roll back an object we just uploaded when a later step in the same operation failed.
    async rollback(path) {
      await removeObjects(BUCKET, path);
    },

    async removeObject(path) {
      await removeObjects(BUCKET, path);
    },

    // Raw upload for the create-then-upload-then-link flow (new staff/teacher, where the owning id
    // only exists after the row is inserted). Returns the stored path.
    async upload(ownerId, file) {
      const invalid = validateImageFile(file);
      if (invalid) throw new Error(invalid);
      return uploadObject(BUCKET, ownerId, file);
    },
  };
}
