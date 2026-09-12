CREATE TABLE community_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 handle TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
 search_name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE community_listings (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_project_id TEXT UNIQUE REFERENCES projects(id) ON DELETE SET NULL,
 owner_available INTEGER NOT NULL DEFAULT 0 CHECK(owner_available IN(0,1)),
 suppressed INTEGER NOT NULL DEFAULT 0 CHECK(suppressed IN(0,1)), deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),
 moderation_reason TEXT, revision INTEGER NOT NULL DEFAULT 1, epoch INTEGER NOT NULL DEFAULT 1,
 current_version INTEGER, pending_job_id TEXT, first_published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX community_listings_live ON community_listings(owner_available,suppressed,deleted,first_published_at,id);
CREATE INDEX community_listings_owner ON community_listings(user_id,updated_at);
CREATE TABLE community_versions (
 listing_id TEXT NOT NULL REFERENCES community_listings(id), version INTEGER NOT NULL,
 document TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL, tags TEXT NOT NULL,
 metadata TEXT NOT NULL, search_text TEXT NOT NULL, disclosure TEXT NOT NULL, attribution TEXT,
 license TEXT NOT NULL CHECK(license='CC-BY-4.0'), source_revision INTEGER NOT NULL, checksum TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'building' CHECK(status IN('building','ready','purging','purged','failed')),
 created_at TEXT NOT NULL, PRIMARY KEY(listing_id,version)
);
CREATE INDEX community_versions_kind ON community_versions(kind,listing_id,version);
CREATE TABLE community_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL, payload_hash TEXT NOT NULL, kind TEXT NOT NULL,
 listing_id TEXT REFERENCES community_listings(id), version INTEGER, epoch INTEGER,
 source_project_id TEXT, input TEXT NOT NULL, result TEXT, status TEXT NOT NULL DEFAULT 'queued',stage TEXT NOT NULL DEFAULT 'accepted',
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,operation_id)
);
CREATE INDEX community_jobs_pending ON community_jobs(status,lease_until);
CREATE TABLE community_files (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 listing_id TEXT REFERENCES community_listings(id), version INTEGER, job_id TEXT NOT NULL REFERENCES community_jobs(id),
 role TEXT NOT NULL CHECK(role IN('asset','cover','download','input')), format TEXT, options TEXT, filename TEXT NOT NULL,
 mime_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>=0), checksum TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN('intent','ready','deleting','deleted')), write_token TEXT, write_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 UNIQUE(job_id,role,filename)
);
CREATE INDEX community_files_version ON community_files(listing_id,version,status,role);
CREATE INDEX community_files_owner ON community_files(user_id,status);
CREATE TABLE community_storage_reservations (
 job_id TEXT PRIMARY KEY REFERENCES community_jobs(id),user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT,
 bytes INTEGER NOT NULL CHECK(bytes>=0),expires_at INTEGER NOT NULL
);
CREATE TABLE community_source_locks (project_id TEXT PRIMARY KEY, deleting INTEGER NOT NULL DEFAULT 0);
CREATE TABLE community_bookmarks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,listing_id TEXT NOT NULL REFERENCES community_listings(id),created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,listing_id)
);
CREATE TABLE community_remix_origins (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,listing_id TEXT,version INTEGER,attribution TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
);
CREATE TABLE community_contributions (
 listing_id TEXT NOT NULL REFERENCES community_listings(id),actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN('download','remix')),first_at TEXT NOT NULL,last_at TEXT NOT NULL,
 PRIMARY KEY(listing_id,actor_id,action)
);
CREATE INDEX community_contributions_rank ON community_contributions(action,first_at,listing_id);
CREATE INDEX community_contributions_listing_action ON community_contributions(listing_id,action,first_at);
CREATE TABLE community_daily_stats (listing_id TEXT NOT NULL REFERENCES community_listings(id),day TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,downloads_served INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(listing_id,day));
CREATE TABLE community_delivery_receipts (listing_id TEXT NOT NULL REFERENCES community_listings(id),day TEXT NOT NULL,identity_hash TEXT NOT NULL,action TEXT NOT NULL,PRIMARY KEY(listing_id,day,identity_hash,action));
CREATE TABLE community_badges (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,badge TEXT NOT NULL,awarded_at TEXT NOT NULL,PRIMARY KEY(user_id,badge));
CREATE TABLE community_collections (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,mutation_token TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE community_collection_items (collection_id TEXT NOT NULL REFERENCES community_collections(id) ON DELETE CASCADE,listing_id TEXT NOT NULL REFERENCES community_listings(id),version INTEGER NOT NULL,position INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(collection_id,listing_id));
CREATE TABLE community_reports (
 id TEXT PRIMARY KEY,listing_id TEXT NOT NULL REFERENCES community_listings(id),version INTEGER NOT NULL,version_checksum TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
 reason TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,operation_id)
);
CREATE INDEX community_reports_queue ON community_reports(status,created_at,id);
CREATE TABLE community_moderation_actions (
 id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES community_reports(id),listing_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),operation_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(actor_id,operation_id)
);
CREATE TABLE community_search_generation (id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL DEFAULT 1);
INSERT INTO community_search_generation(id,generation) VALUES(1,1);
CREATE VIRTUAL TABLE community_search USING fts5(listing_id UNINDEXED,text,tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER community_listing_search_update AFTER UPDATE ON community_listings BEGIN
 DELETE FROM community_search WHERE listing_id=NEW.id;
 INSERT INTO community_search(listing_id,text) SELECT NEW.id,v.search_text || ' ' || p.search_name FROM community_versions v JOIN community_profiles p ON p.user_id=NEW.user_id WHERE v.listing_id=NEW.id AND v.version=NEW.current_version AND v.status='ready' AND NEW.owner_available=1 AND NEW.suppressed=0 AND NEW.deleted=0;
 UPDATE community_search_generation SET generation=generation+1 WHERE id=1;
END;
CREATE TRIGGER community_profile_search_update AFTER UPDATE ON community_profiles BEGIN
 DELETE FROM community_search WHERE listing_id IN(SELECT id FROM community_listings WHERE user_id=NEW.user_id);
 INSERT INTO community_search(listing_id,text) SELECT l.id,v.search_text || ' ' || NEW.search_name FROM community_listings l JOIN community_versions v ON v.listing_id=l.id AND v.version=l.current_version WHERE l.user_id=NEW.user_id AND v.status='ready' AND l.owner_available=1 AND l.suppressed=0 AND l.deleted=0;
 UPDATE community_search_generation SET generation=generation+1 WHERE id=1;
END;
CREATE TRIGGER community_contribution_generation AFTER INSERT ON community_contributions BEGIN UPDATE community_search_generation SET generation=generation+1 WHERE id=1; END;
