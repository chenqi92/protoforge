// 集合管理 + 历史记录 — SQLite 持久化
// 所有数据通过 SqlitePool 读写，无内存缓存

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// 集合
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub auth: Option<String>,
    pub pre_script: String,
    pub post_script: String,
    pub variables: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 集合项（请求或文件夹）
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    pub id: String,
    pub collection_id: String,
    pub parent_id: Option<String>,
    pub item_type: String,       // "request" | "folder"
    pub name: String,
    pub sort_order: i64,
    pub method: Option<String>,
    pub url: Option<String>,
    pub headers: String,
    pub query_params: String,
    pub body_type: String,
    pub body_content: String,
    pub auth_type: String,
    pub auth_config: String,
    pub pre_script: String,
    pub post_script: String,
    pub response_example: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 历史记录条目
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub method: String,
    pub url: String,
    pub status: Option<i64>,
    pub duration_ms: Option<i64>,
    pub body_size: Option<i64>,
    pub request_config: Option<String>,
    pub response_summary: Option<String>,
    pub created_at: String,
}

/// 历史记录摘要（不含 request_config / response_summary，用于列表展示）
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntrySummary {
    pub id: String,
    pub method: String,
    pub url: String,
    pub status: Option<i64>,
    pub duration_ms: Option<i64>,
    pub body_size: Option<i64>,
    pub created_at: String,
}

/// 环境
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub name: String,
    pub is_active: i64,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 环境变量
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EnvVariable {
    pub id: String,
    pub environment_id: String,
    pub key: String,
    pub value: String,
    pub enabled: i64,
    pub is_secret: i64,
    pub sort_order: i64,
}

/// 全局变量
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GlobalVariable {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: i64,
}

// ═══════════════════════════════════════════
//  Collections CRUD
// ═══════════════════════════════════════════

pub async fn list_collections(pool: &SqlitePool) -> Result<Vec<Collection>, String> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections ORDER BY sort_order, name")
        .fetch_all(pool).await.map_err(|e| format!("查询集合失败: {}", e))
}

pub async fn get_collection(pool: &SqlitePool, id: &str) -> Result<Collection, String> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections WHERE id = ?")
        .bind(id)
        .fetch_one(pool).await.map_err(|e| format!("集合不存在: {}", e))
}

pub async fn create_collection(pool: &SqlitePool, col: Collection) -> Result<Collection, String> {
    sqlx::query(
        "INSERT INTO collections (id, name, description, auth, pre_script, post_script, variables, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&col.id).bind(&col.name).bind(&col.description).bind(&col.auth)
    .bind(&col.pre_script).bind(&col.post_script).bind(&col.variables)
    .bind(col.sort_order).bind(&col.created_at).bind(&col.updated_at)
    .execute(pool).await.map_err(|e| format!("创建集合失败: {}", e))?;
    Ok(col)
}

pub async fn update_collection(pool: &SqlitePool, col: Collection) -> Result<(), String> {
    let result = sqlx::query(
        "UPDATE collections SET name=?, description=?, auth=?, pre_script=?, post_script=?, variables=?, sort_order=?, updated_at=? WHERE id=?"
    )
    .bind(&col.name).bind(&col.description).bind(&col.auth)
    .bind(&col.pre_script).bind(&col.post_script).bind(&col.variables)
    .bind(col.sort_order).bind(&col.updated_at).bind(&col.id)
    .execute(pool).await.map_err(|e| format!("更新集合失败: {}", e))?;
    if result.rows_affected() == 0 {
        return Err("集合不存在".to_string());
    }
    Ok(())
}

pub async fn delete_collection(pool: &SqlitePool, id: &str) -> Result<(), String> {
    // 级联删除关联的集合项（避免孤儿数据）
    sqlx::query("DELETE FROM collection_items WHERE collection_id = ?")
        .bind(id)
        .execute(pool).await.map_err(|e| format!("删除集合项失败: {}", e))?;
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(id)
        .execute(pool).await.map_err(|e| format!("删除集合失败: {}", e))?;
    Ok(())
}

pub async fn export_collection(pool: &SqlitePool, id: &str) -> Result<String, String> {
    let col = get_collection(pool, id).await?;
    let items = list_collection_items(pool, id).await?;
    let export = serde_json::json!({ "collection": col, "items": items });
    serde_json::to_string_pretty(&export).map_err(|e| format!("导出失败: {}", e))
}

pub async fn import_collection(pool: &SqlitePool, json: &str) -> Result<Collection, String> {
    let data: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("导入解析失败: {}", e))?;

    let col: Collection = serde_json::from_value(
        data.get("collection").cloned().unwrap_or(data.clone())
    ).map_err(|e| format!("集合数据格式错误: {}", e))?;

    create_collection(pool, col.clone()).await?;

    if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
        for item_val in items {
            if let Ok(item) = serde_json::from_value::<CollectionItem>(item_val.clone()) {
                let _ = create_collection_item(pool, item).await;
            }
        }
    }
    Ok(col)
}

// ═══════════════════════════════════════════
//  Collection Items CRUD
// ═══════════════════════════════════════════

pub async fn list_collection_items(pool: &SqlitePool, collection_id: &str) -> Result<Vec<CollectionItem>, String> {
    sqlx::query_as::<_, CollectionItem>(
        "SELECT * FROM collection_items WHERE collection_id = ? ORDER BY sort_order, name"
    )
    .bind(collection_id)
    .fetch_all(pool).await.map_err(|e| format!("查询集合项失败: {}", e))
}

pub async fn create_collection_item(pool: &SqlitePool, item: CollectionItem) -> Result<CollectionItem, String> {
    sqlx::query(
        "INSERT INTO collection_items (id, collection_id, parent_id, item_type, name, sort_order,
         method, url, headers, query_params, body_type, body_content, auth_type, auth_config,
         pre_script, post_script, response_example, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&item.id).bind(&item.collection_id).bind(&item.parent_id)
    .bind(&item.item_type).bind(&item.name).bind(item.sort_order)
    .bind(&item.method).bind(&item.url).bind(&item.headers).bind(&item.query_params)
    .bind(&item.body_type).bind(&item.body_content).bind(&item.auth_type).bind(&item.auth_config)
    .bind(&item.pre_script).bind(&item.post_script).bind(&item.response_example)
    .bind(&item.created_at).bind(&item.updated_at)
    .execute(pool).await.map_err(|e| format!("创建集合项失败: {}", e))?;
    Ok(item)
}

pub async fn update_collection_item(pool: &SqlitePool, item: CollectionItem) -> Result<(), String> {
    sqlx::query(
        "UPDATE collection_items SET name=?, sort_order=?, method=?, url=?, headers=?, query_params=?,
         body_type=?, body_content=?, auth_type=?, auth_config=?, pre_script=?, post_script=?,
         response_example=?, updated_at=?
         WHERE id=?"
    )
    .bind(&item.name).bind(item.sort_order).bind(&item.method).bind(&item.url)
    .bind(&item.headers).bind(&item.query_params).bind(&item.body_type).bind(&item.body_content)
    .bind(&item.auth_type).bind(&item.auth_config).bind(&item.pre_script).bind(&item.post_script)
    .bind(&item.response_example).bind(&item.updated_at).bind(&item.id)
    .execute(pool).await.map_err(|e| format!("更新集合项失败: {}", e))?;
    Ok(())
}

pub async fn delete_collection_item(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_items WHERE id = ?")
        .bind(id)
        .execute(pool).await.map_err(|e| format!("删除集合项失败: {}", e))?;
    Ok(())
}

/// Batch update sort_order for collection items (used by drag-drop reorder)
pub async fn reorder_collection_items(pool: &SqlitePool, item_ids: Vec<String>) -> Result<(), String> {
    // 使用事务包裹批量更新，避免部分成功部分失败
    let mut tx = pool.begin().await.map_err(|e| format!("开始事务失败: {}", e))?;
    for (idx, id) in item_ids.iter().enumerate() {
        sqlx::query("UPDATE collection_items SET sort_order = ? WHERE id = ?")
            .bind(idx as i64)
            .bind(id)
            .execute(&mut *tx).await.map_err(|e| format!("排序更新失败: {}", e))?;
    }
    tx.commit().await.map_err(|e| format!("提交事务失败: {}", e))?;
    Ok(())
}

/// 集合去重：同一 parent_id 下 method+url 相同的请求，保留 sort_order 最小的一条
pub async fn deduplicate_collection_items(pool: &SqlitePool, collection_id: &str) -> Result<u64, String> {
    let result = sqlx::query(
        "DELETE FROM collection_items WHERE id IN (
            SELECT ci.id FROM collection_items ci
            INNER JOIN (
                SELECT MIN(id) AS keep_id, COALESCE(parent_id, '') AS pid, method, url
                FROM collection_items
                WHERE collection_id = ? AND item_type = 'request' AND method IS NOT NULL AND url IS NOT NULL
                GROUP BY COALESCE(parent_id, ''), method, url
                HAVING COUNT(*) > 1
            ) dup ON COALESCE(ci.parent_id, '') = dup.pid AND ci.method = dup.method AND ci.url = dup.url
            WHERE ci.collection_id = ? AND ci.item_type = 'request' AND ci.id != dup.keep_id
        )"
    )
    .bind(collection_id)
    .bind(collection_id)
    .execute(pool).await.map_err(|e| format!("去重失败: {}", e))?;
    Ok(result.rows_affected())
}

// ═══════════════════════════════════════════
//  Environments CRUD
// ═══════════════════════════════════════════

pub async fn list_environments(pool: &SqlitePool) -> Result<Vec<Environment>, String> {
    sqlx::query_as::<_, Environment>("SELECT * FROM environments ORDER BY sort_order, name")
        .fetch_all(pool).await.map_err(|e| format!("查询环境失败: {}", e))
}

pub async fn create_environment(pool: &SqlitePool, env: Environment) -> Result<Environment, String> {
    sqlx::query(
        "INSERT INTO environments (id, name, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(&env.id).bind(&env.name).bind(env.is_active)
    .bind(env.sort_order).bind(&env.created_at).bind(&env.updated_at)
    .execute(pool).await.map_err(|e| format!("创建环境失败: {}", e))?;
    Ok(env)
}

pub async fn set_active_environment(pool: &SqlitePool, id: Option<&str>) -> Result<(), String> {
    // 使用事务保证原子性：避免全部取消激活后设置激活失败
    let mut tx = pool.begin().await.map_err(|e| format!("开始事务失败: {}", e))?;
    // 先全部取消激活
    sqlx::query("UPDATE environments SET is_active = 0")
        .execute(&mut *tx).await.map_err(|e| format!("更新环境失败: {}", e))?;
    // 激活指定环境
    if let Some(env_id) = id {
        sqlx::query("UPDATE environments SET is_active = 1 WHERE id = ?")
            .bind(env_id)
            .execute(&mut *tx).await.map_err(|e| format!("激活环境失败: {}", e))?;
    }
    tx.commit().await.map_err(|e| format!("提交事务失败: {}", e))?;
    Ok(())
}

pub async fn get_active_environment(pool: &SqlitePool) -> Result<Option<Environment>, String> {
    sqlx::query_as::<_, Environment>("SELECT * FROM environments WHERE is_active = 1 LIMIT 1")
        .fetch_optional(pool).await.map_err(|e| format!("查询活跃环境失败: {}", e))
}

pub async fn delete_environment(pool: &SqlitePool, id: &str) -> Result<(), String> {
    // 级联删除关联的环境变量（避免孤儿数据）
    sqlx::query("DELETE FROM environment_variables WHERE environment_id = ?")
        .bind(id)
        .execute(pool).await.map_err(|e| format!("删除环境变量失败: {}", e))?;
    sqlx::query("DELETE FROM environments WHERE id = ?")
        .bind(id)
        .execute(pool).await.map_err(|e| format!("删除环境失败: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════
//  Environment Variables CRUD
// ═══════════════════════════════════════════

pub async fn list_env_variables(pool: &SqlitePool, env_id: &str) -> Result<Vec<EnvVariable>, String> {
    sqlx::query_as::<_, EnvVariable>(
        "SELECT * FROM environment_variables WHERE environment_id = ? ORDER BY sort_order"
    )
    .bind(env_id)
    .fetch_all(pool).await.map_err(|e| format!("查询环境变量失败: {}", e))
}

pub async fn save_env_variables(pool: &SqlitePool, env_id: &str, vars: Vec<EnvVariable>) -> Result<(), String> {
    // 使用事务保证原子性：避免删除后插入失败导致数据丢失
    let mut tx = pool.begin().await.map_err(|e| format!("开始事务失败: {}", e))?;
    sqlx::query("DELETE FROM environment_variables WHERE environment_id = ?")
        .bind(env_id)
        .execute(&mut *tx).await.map_err(|e| format!("清除旧变量失败: {}", e))?;

    for var in vars {
        sqlx::query(
            "INSERT INTO environment_variables (id, environment_id, key, value, enabled, is_secret, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&var.id).bind(env_id).bind(&var.key).bind(&var.value)
        .bind(var.enabled).bind(var.is_secret).bind(var.sort_order)
        .execute(&mut *tx).await.map_err(|e| format!("保存变量失败: {}", e))?;
    }
    tx.commit().await.map_err(|e| format!("提交事务失败: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════
//  Global Variables CRUD
// ═══════════════════════════════════════════

pub async fn list_global_variables(pool: &SqlitePool) -> Result<Vec<GlobalVariable>, String> {
    sqlx::query_as::<_, GlobalVariable>("SELECT * FROM global_variables ORDER BY key")
        .fetch_all(pool).await.map_err(|e| format!("查询全局变量失败: {}", e))
}

pub async fn save_global_variables(pool: &SqlitePool, vars: Vec<GlobalVariable>) -> Result<(), String> {
    // 使用事务保证原子性
    let mut tx = pool.begin().await.map_err(|e| format!("开始事务失败: {}", e))?;
    sqlx::query("DELETE FROM global_variables")
        .execute(&mut *tx).await.map_err(|e| format!("清除全局变量失败: {}", e))?;

    for var in vars {
        sqlx::query(
            "INSERT INTO global_variables (id, key, value, enabled) VALUES (?, ?, ?, ?)"
        )
        .bind(&var.id).bind(&var.key).bind(&var.value).bind(var.enabled)
        .execute(&mut *tx).await.map_err(|e| format!("保存全局变量失败: {}", e))?;
    }
    tx.commit().await.map_err(|e| format!("提交事务失败: {}", e))?;
    Ok(())
}

// ═══════════════════════════════════════════
//  History CRUD
// ═══════════════════════════════════════════

pub async fn add_history(pool: &SqlitePool, entry: HistoryEntry) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO history (id, method, url, status, duration_ms, body_size, request_config, response_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&entry.id).bind(&entry.method).bind(&entry.url)
    .bind(entry.status).bind(entry.duration_ms).bind(entry.body_size)
    .bind(&entry.request_config).bind(&entry.response_summary).bind(&entry.created_at)
    .execute(pool).await.map_err(|e| format!("保存历史失败: {}", e))?;

    // 自动清理超过 500 条的旧记录
    sqlx::query(
        "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY created_at DESC LIMIT 500)"
    )
    .execute(pool).await.map_err(|e| format!("清理历史失败: {}", e))?;

    Ok(())
}

pub async fn list_history(pool: &SqlitePool, limit: i64) -> Result<Vec<HistoryEntry>, String> {
    sqlx::query_as::<_, HistoryEntry>(
        "SELECT * FROM history ORDER BY created_at DESC LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool).await.map_err(|e| format!("查询历史失败: {}", e))
}

/// 轻量列表：不返回 request_config / response_summary，节省内存
pub async fn list_history_summary(pool: &SqlitePool, limit: i64) -> Result<Vec<HistoryEntrySummary>, String> {
    sqlx::query_as::<_, HistoryEntrySummary>(
        "SELECT id, method, url, status, duration_ms, body_size, created_at FROM history ORDER BY created_at DESC LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool).await.map_err(|e| format!("查询历史摘要失败: {}", e))
}

/// 按 ID 获取完整历史记录（含 request_config）
pub async fn get_history_entry(pool: &SqlitePool, id: &str) -> Result<HistoryEntry, String> {
    sqlx::query_as::<_, HistoryEntry>(
        "SELECT * FROM history WHERE id = ?"
    )
    .bind(id)
    .fetch_one(pool).await.map_err(|e| format!("历史记录不存在: {}", e))
}

pub async fn delete_history_entry(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM history WHERE id = ?")
        .bind(id)
        .execute(pool).await.map_err(|e| format!("删除历史失败: {}", e))?;
    Ok(())
}

pub async fn clear_history(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("DELETE FROM history")
        .execute(pool).await.map_err(|e| format!("清空历史失败: {}", e))?;
    Ok(())
}
