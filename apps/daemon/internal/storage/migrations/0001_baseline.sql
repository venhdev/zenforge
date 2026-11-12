-- 0001 — ZenForge baseline schema (v0.1.0)
-- Frozen after the v0.1.0 release: never edit this file once applied.
-- All schema changes after v0.1.0 must be a new migrations/NNNN_*.sql step.

CREATE TABLE projects (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX idx_projects_status ON projects (status);

CREATE TABLE plans (
    slug TEXT PRIMARY KEY,
    project_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (project_slug) REFERENCES projects (slug) ON DELETE CASCADE
);
CREATE INDEX idx_plans_project ON plans (project_slug, status);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_slug TEXT,
    plan_slug TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dependencies TEXT NOT NULL DEFAULT '[]',
    priority TEXT NOT NULL DEFAULT 'P2',
    complexity TEXT NOT NULL DEFAULT 'MEDIUM',
    risk_level TEXT NOT NULL DEFAULT 'LOW',
    agent_slug TEXT NOT NULL DEFAULT '',
    required_skills TEXT NOT NULL DEFAULT '[]',
    required_docs TEXT NOT NULL DEFAULT '[]',
    target_files TEXT NOT NULL DEFAULT '[]',
    acceptance_criteria TEXT NOT NULL DEFAULT '[]',
    verification_commands TEXT NOT NULL DEFAULT '[]',
    worktree_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    claimed_by TEXT NOT NULL DEFAULT '',
    claimed_at DATETIME,
    claim_session_id TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    review_reason TEXT NOT NULL DEFAULT '',
    review_details TEXT NOT NULL DEFAULT '',
    review_options TEXT NOT NULL DEFAULT '[]',
    auto_run INTEGER NOT NULL DEFAULT 0,
    phases TEXT NOT NULL DEFAULT '[]',
    current_phase TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    CHECK (plan_slug IS NULL OR project_slug IS NOT NULL),
    FOREIGN KEY (project_slug) REFERENCES projects (slug) ON DELETE CASCADE,
    FOREIGN KEY (plan_slug) REFERENCES plans (slug) ON DELETE CASCADE
);
CREATE INDEX idx_tasks_project ON tasks (project_slug);
CREATE INDEX idx_tasks_plan ON tasks (plan_slug);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_updated ON tasks (updated_at);
CREATE INDEX idx_tasks_project_status ON tasks (project_slug, status);
CREATE INDEX idx_tasks_plan_status ON tasks (plan_slug, status);
CREATE INDEX idx_tasks_agent ON tasks (agent_slug);
CREATE INDEX idx_tasks_autorun ON tasks (auto_run, status);

CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    project_slug TEXT,
    key TEXT NOT NULL,
    slug TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'spec',
    type TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'PROJECT',
    scope_ref TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT 'markdown',
    types_json TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT NOT NULL DEFAULT '',
    byte_size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (project_slug) REFERENCES projects (slug) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ux_resources_project_key ON resources (IFNULL(project_slug, ''), key);
CREATE UNIQUE INDEX ux_resources_project_slug ON resources (IFNULL(project_slug, ''), slug);
CREATE INDEX idx_resources_project ON resources (project_slug);
CREATE INDEX idx_resources_kind ON resources (kind);
CREATE INDEX idx_resources_type ON resources (type);
CREATE INDEX idx_resources_scope ON resources (scope, scope_ref);
CREATE INDEX idx_resources_status ON resources (status);

CREATE TABLE resource_tags (
    resource_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (resource_id, tag),
    FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE CASCADE
);
CREATE INDEX idx_resource_tags_tag ON resource_tags (tag);

CREATE VIRTUAL TABLE resources_fts USING fts5(
    resource_id UNINDEXED,
    key,
    slug,
    kind,
    title,
    summary,
    content,
    types_text,
    tokenize = 'porter'
);

CREATE TABLE agents (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    soul_key TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'HEADLESS',
    goal TEXT NOT NULL DEFAULT '',
    start_conditions TEXT NOT NULL DEFAULT '{}',
    stop_conditions TEXT NOT NULL DEFAULT '{}',
    schedule TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '[]',
    runner TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX idx_agents_enabled ON agents (enabled);
CREATE INDEX idx_agents_soul ON agents (soul_key);

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    resource_id TEXT,
    role TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE CASCADE,
    CHECK ((task_id IS NOT NULL) <> (resource_id IS NOT NULL))
);
CREATE INDEX idx_artifacts_task ON artifacts (task_id);
CREATE INDEX idx_artifacts_resource ON artifacts (resource_id);
CREATE INDEX idx_artifacts_role ON artifacts (role);

CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_slug TEXT,
    plan_slug TEXT,
    task_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp DATETIME NOT NULL
);
CREATE INDEX idx_events_entity ON events (entity_type, entity_id);
CREATE INDEX idx_events_project ON events (project_slug);
CREATE INDEX idx_events_plan ON events (plan_slug);
CREATE INDEX idx_events_task ON events (task_id);
CREATE INDEX idx_events_timestamp ON events (timestamp);

-- Resource FTS synchronization -------------------------------------------------

CREATE TRIGGER trg_resources_fts_insert AFTER INSERT ON resources BEGIN
    INSERT INTO resources_fts (resource_id, key, slug, kind, title, summary, content, types_text)
    VALUES (NEW.id, NEW.key, NEW.slug, NEW.kind, NEW.title, NEW.summary, NEW.content, NEW.types_json);
END;

CREATE TRIGGER trg_resources_fts_update AFTER UPDATE ON resources BEGIN
    DELETE FROM resources_fts WHERE resource_id = OLD.id;
    INSERT INTO resources_fts (resource_id, key, slug, kind, title, summary, content, types_text)
    VALUES (NEW.id, NEW.key, NEW.slug, NEW.kind, NEW.title, NEW.summary, NEW.content, NEW.types_json);
END;

CREATE TRIGGER trg_resources_fts_delete AFTER DELETE ON resources BEGIN
    DELETE FROM resources_fts WHERE resource_id = OLD.id;
END;

-- Activity log ----------------------------------------------------------------

CREATE TRIGGER trg_audit_project_insert AFTER INSERT ON projects BEGIN
    INSERT INTO events (project_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.slug, 'project', NEW.slug, 'project.created',
        json_object('slug', NEW.slug, 'name', NEW.name, 'status', NEW.status), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_project_update AFTER UPDATE ON projects BEGIN
    INSERT INTO events (project_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.slug, 'project', NEW.slug, 'project.updated',
        json_object('slug', NEW.slug, 'name', NEW.name, 'status', NEW.status,
            'kind', CASE
                WHEN OLD.status <> NEW.status THEN 'status'
                WHEN OLD.name <> NEW.name THEN 'name'
                WHEN OLD.root_path <> NEW.root_path THEN 'root_path'
                ELSE 'metadata' END), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_project_delete AFTER DELETE ON projects BEGIN
    INSERT INTO events (project_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (OLD.slug, 'project', OLD.slug, 'project.deleted',
        json_object('slug', OLD.slug, 'name', OLD.name), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_plan_insert AFTER INSERT ON plans BEGIN
    INSERT INTO events (project_slug, plan_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.project_slug, NEW.slug, 'plan', NEW.slug, 'plan.created',
        json_object('slug', NEW.slug, 'project_slug', NEW.project_slug, 'title', NEW.title, 'status', NEW.status, 'version', NEW.version),
        CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_plan_update AFTER UPDATE ON plans BEGIN
    INSERT INTO events (project_slug, plan_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.project_slug, NEW.slug, 'plan', NEW.slug, 'plan.updated',
        json_object('slug', NEW.slug, 'project_slug', NEW.project_slug, 'version', NEW.version,
            'kind', CASE
                WHEN OLD.status <> NEW.status THEN 'status'
                WHEN OLD.title <> NEW.title THEN 'title'
                WHEN OLD.version <> NEW.version THEN 'version'
                ELSE 'metadata' END,
            'from', OLD.status, 'to', NEW.status), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_plan_delete AFTER DELETE ON plans BEGIN
    INSERT INTO events (project_slug, plan_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (OLD.project_slug, OLD.slug, 'plan', OLD.slug, 'plan.deleted',
        json_object('slug', OLD.slug, 'project_slug', OLD.project_slug, 'title', OLD.title), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_task_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO events (project_slug, plan_slug, task_id, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.project_slug, NEW.plan_slug, NEW.id, 'task', NEW.id, 'task.created',
        json_object('task_id', NEW.id, 'project_slug', NEW.project_slug, 'plan_slug', NEW.plan_slug,
            'title', NEW.title, 'status', NEW.status), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_task_update AFTER UPDATE ON tasks BEGIN
    INSERT INTO events (project_slug, plan_slug, task_id, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.project_slug, NEW.plan_slug, NEW.id, 'task', NEW.id, 'task.updated',
        json_object('task_id', NEW.id, 'project_slug', NEW.project_slug, 'plan_slug', NEW.plan_slug,
            'kind', CASE
                WHEN OLD.status <> NEW.status THEN 'status'
                WHEN OLD.notes <> NEW.notes THEN 'notes'
                WHEN OLD.dependencies <> NEW.dependencies THEN 'dependencies'
                WHEN OLD.claimed_by <> NEW.claimed_by THEN 'claim'
                ELSE 'metadata' END,
            'from', OLD.status, 'to', NEW.status, 'claimed_by', NEW.claimed_by), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_task_delete AFTER DELETE ON tasks BEGIN
    INSERT INTO events (project_slug, plan_slug, task_id, entity_type, entity_id, type, payload, timestamp)
    VALUES (OLD.project_slug, OLD.plan_slug, OLD.id, 'task', OLD.id, 'task.deleted',
        json_object('task_id', OLD.id, 'project_slug', OLD.project_slug, 'plan_slug', OLD.plan_slug, 'title', OLD.title),
        CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_resource_insert AFTER INSERT ON resources BEGIN
    INSERT INTO events (project_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.project_slug, 'resource', NEW.id, 'resource.created',
        json_object('id', NEW.id, 'project_slug', NEW.project_slug, 'key', NEW.key, 'slug', NEW.slug,
            'kind', NEW.kind, 'type', NEW.type, 'scope', NEW.scope, 'title', NEW.title, 'path', NEW.path), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_resource_update AFTER UPDATE ON resources BEGIN
    INSERT INTO events (project_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.project_slug, 'resource', NEW.id, 'resource.updated',
        json_object('id', NEW.id, 'project_slug', NEW.project_slug, 'key', NEW.key, 'slug', NEW.slug,
            'kind', NEW.kind, 'type', NEW.type, 'scope', NEW.scope, 'title', NEW.title,
            'update_kind', CASE
                WHEN OLD.status <> NEW.status THEN 'status'
                WHEN OLD.path <> NEW.path THEN 'path'
                WHEN OLD.content_hash <> NEW.content_hash THEN 'content'
                WHEN OLD.title <> NEW.title THEN 'title'
                WHEN OLD.kind <> NEW.kind THEN 'kind'
                ELSE 'metadata' END,
            'version', NEW.version), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_resource_delete AFTER DELETE ON resources BEGIN
    INSERT INTO events (project_slug, entity_type, entity_id, type, payload, timestamp)
    VALUES (OLD.project_slug, 'resource', OLD.id, 'resource.deleted',
        json_object('id', OLD.id, 'project_slug', OLD.project_slug, 'key', OLD.key, 'slug', OLD.slug, 'title', OLD.title),
        CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_resource_tag_insert AFTER INSERT ON resource_tags BEGIN
    INSERT INTO events (entity_type, entity_id, type, payload, timestamp)
    VALUES ('resource', NEW.resource_id, 'resource.tagged',
        json_object('resource_id', NEW.resource_id, 'tag', NEW.tag), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_resource_tag_delete AFTER DELETE ON resource_tags BEGIN
    INSERT INTO events (entity_type, entity_id, type, payload, timestamp)
    VALUES ('resource', OLD.resource_id, 'resource.untagged',
        json_object('resource_id', OLD.resource_id, 'tag', OLD.tag), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_agent_insert AFTER INSERT ON agents BEGIN
    INSERT INTO events (entity_type, entity_id, type, payload, timestamp)
    VALUES ('agent', NEW.slug, 'agent.created',
        json_object('slug', NEW.slug, 'name', NEW.name, 'soul_key', NEW.soul_key, 'mode', NEW.mode, 'enabled', NEW.enabled),
        CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_agent_update AFTER UPDATE ON agents BEGIN
    INSERT INTO events (entity_type, entity_id, type, payload, timestamp)
    VALUES ('agent', NEW.slug, 'agent.updated',
        json_object('slug', NEW.slug, 'name', NEW.name, 'soul_key', NEW.soul_key, 'mode', NEW.mode, 'enabled', NEW.enabled),
        CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_agent_delete AFTER DELETE ON agents BEGIN
    INSERT INTO events (entity_type, entity_id, type, payload, timestamp)
    VALUES ('agent', OLD.slug, 'agent.deleted',
        json_object('slug', OLD.slug, 'name', OLD.name), CURRENT_TIMESTAMP);
END;

CREATE TRIGGER trg_audit_artifact_insert AFTER INSERT ON artifacts BEGIN
    INSERT INTO events (task_id, entity_type, entity_id, type, payload, timestamp)
    VALUES (NEW.task_id, 'artifact', NEW.id, 'artifact.added',
        json_object('artifact_id', NEW.id, 'task_id', NEW.task_id, 'role', NEW.role,
            'name', NEW.name, 'type', NEW.type, 'mime_type', NEW.mime_type), CURRENT_TIMESTAMP);
END;
