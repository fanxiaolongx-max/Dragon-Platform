// Table documentation follows the current repositories. It describes tables in
// the explorer only; it never changes SQLite schemas or business data.
const GROUPS = {
    "sla": [
        "SLA 与指标规则",
        "SLA & Metric Rules"
    ],
    "imports": [
        "数据导入与源表",
        "Imports & Source Tables"
    ],
    "reports": [
        "报表与月报",
        "Reports & Monthly Reports"
    ],
    "auth": [
        "账号、租户与安全",
        "Accounts, Tenants & Security"
    ],
    "ai": [
        "AI 会话与智能体",
        "AI Chat & Agents"
    ],
    "knowledge": [
        "AI 知识索引",
        "AI Knowledge Index"
    ],
    "chat": [
        "聊天记录中心",
        "Chat History"
    ],
    "channels": [
        "消息渠道与催办",
        "Channels & Follow-ups"
    ],
    "datacom": [
        "数通知识库",
        "Datacom Knowledge"
    ],
    "operations": [
        "运营、激励与考勤",
        "Operations & Incentives"
    ],
    "tools": [
        "脚本与工具",
        "Scripts & Tools"
    ],
    "system": [
        "平台运行与配置",
        "Platform Runtime & Settings"
    ],
    "publish": [
        "静态发布与访问",
        "Publishing & Access"
    ],
    "surveys": [
        "问卷与需求",
        "Surveys & Requirements"
    ],
    "warehouse": [
        "仓储管理",
        "Warehouse"
    ]
};
const DEFINITIONS = new Map([
    ["sla_targets", {"category": "sla", "description": "指标目标、权重、达标条件及加分规则。", "descriptionEn": "Metric targets, weights, passing conditions and bonus rules.", "source": "backend/models/sla-targets-repository.js"}],
    ["sla_groups", {"category": "sla", "description": "指标分组名称及显示顺序。", "descriptionEn": "Metric group names and display order.", "source": "backend/models/sla-groups-repository.js"}],
    ["sla_group_items", {"category": "sla", "description": "每个指标分组包含的指标及组内排序。", "descriptionEn": "Group membership and metric order within groups.", "source": "backend/models/sla-groups-repository.js"}],
    ["sla_categories", {"category": "sla", "description": "SLA 业务类别清单。", "descriptionEn": "Available SLA business categories.", "source": "backend/models/sla-categories-repository.js"}],
    ["sla_prefs", {"category": "sla", "description": "表格列宽、显示字段、自定义指标及提取偏好。", "descriptionEn": "Table columns, custom metrics and extraction preferences.", "source": "backend/models/sla-prefs-repository.js"}],
    ["sla_rule_templates", {"category": "sla", "description": "指标提取或计算规则的文本模板。", "descriptionEn": "Text templates for metric extraction and calculation rules.", "source": "backend/models/sla-rule-templates-repository.js"}],
    ["sla_snapshots", {"category": "sla", "description": "SLA 历史快照，保存当时指标、源表与时间。", "descriptionEn": "Historical SLA snapshots with captured metrics, sources and timestamps.", "source": "backend/models/report-data-transfer-repository.js"}],
    ["sla_copied_field_stats", {"category": "sla", "description": "SLA 字段复制使用次数统计。", "descriptionEn": "Usage counts for copied SLA fields.", "source": "backend/models/sla-copied-fields-repository.js"}],
    ["import_source_batches", {"category": "imports", "description": "每次导入的批次、来源、目标月份和创建时间。", "descriptionEn": "Import batches with source, target month and creation time.", "source": "backend/models/import-source-repository.js"}],
    ["import_source_files", {"category": "imports", "description": "导入原文件、文件指纹、大小及解析状态。", "descriptionEn": "Original imported files, fingerprints, sizes and parse status.", "source": "backend/models/import-source-repository.js"}],
    ["import_source_sheets", {"category": "imports", "description": "原文件各工作表的表头、行数据与行数。", "descriptionEn": "Worksheet headers, row data and row counts.", "source": "backend/models/import-source-repository.js"}],
    ["import_source_snapshots", {"category": "imports", "description": "归档指标快照与导入批次、目标月份的关联。", "descriptionEn": "Archived metric snapshots linked to import batches and target months.", "source": "backend/models/import-source-repository.js"}],
    ["import_source_settings", {"category": "imports", "description": "是否保存原始上传文件的租户设置。", "descriptionEn": "Tenant setting controlling original file retention.", "source": "backend/models/import-source-repository.js"}],
    ["source_table_rules", {"category": "imports", "description": "按源表类型保存的数据清洗与转换规则。", "descriptionEn": "Cleaning and transformation rules by source table type.", "source": "backend/models/import-source-repository.js"}],
    ["source_category_rules", {"category": "imports", "description": "原始数据来源的业务分类与匹配规则。", "descriptionEn": "Business categories and matching rules for source data.", "source": "backend/models/source-category-repository.js"}],
    ["source_presentation_rules", {"category": "imports", "description": "源表的展示格式与修订版本。", "descriptionEn": "Source table presentation rules and revisions.", "source": "backend/models/source-presentation-repository.js"}],
    ["upload_history", {"category": "imports", "description": "文件上传历史及处理结果记录。", "descriptionEn": "File upload history and processing results.", "source": "backend/models/upload-history-repository.js"}],
    ["ai_report_documents", {"category": "reports", "description": "AI 月报文档、报告月份、内容与编辑信息。", "descriptionEn": "AI report documents, reporting months, content and editing metadata.", "source": "backend/models/ai-report-repository.js"}],
    ["ai_report_images", {"category": "reports", "description": "AI 月报图库中上传或生成的图片与元数据。", "descriptionEn": "Uploaded or generated images and metadata in the AI report image library.", "source": "backend/models/ai-report-images.js"}],
    ["ai_report_image_deletions", {"category": "reports", "description": "AI 月报图库批量删除确认提案与审核状态。", "descriptionEn": "Batch deletion proposals and review state for AI report images.", "source": "backend/models/ai-report-images.js"}],
    ["ai_report_image_hidden", {"category": "reports", "description": "AI 月报图库中已被隐藏或软删除的图片记录。", "descriptionEn": "Hidden or soft-deleted image records in the AI report image library.", "source": "backend/models/ai-report-images.js"}],
    ["monthly_report_snapshots", {"category": "reports", "description": "按工具、专题和月份保存的月报历史快照。", "descriptionEn": "Monthly report snapshots by tool, topic and reporting month.", "source": "backend/models/monthly-snapshots-repository.js"}],
    ["monthly_documents", {"category": "reports", "description": "源数据月报编辑器保存的文档内容。", "descriptionEn": "Documents saved by the source-data report editor.", "source": "backend/models/import-source-repository.js"}],
    ["monthly_document_drafts", {"category": "reports", "description": "按所有者保存的月报文档工作草稿与修订。", "descriptionEn": "Owned monthly report working drafts and revisions.", "source": "backend/models/monthly-draft-repository.js"}],
    ["monthly_draft_history", {"category": "reports", "description": "已归档的月报草稿历史版本。", "descriptionEn": "Archived historical versions of monthly report drafts.", "source": "backend/models/monthly-draft-repository.js"}],
    ["monthly_default_template", {"category": "reports", "description": "月报编辑器使用的默认模板。", "descriptionEn": "Default template used by the monthly report editor.", "source": "backend/models/monthly-template-repository.js"}],
    ["monthly_component_presets", {"category": "reports", "description": "可复用的月报组件配置。", "descriptionEn": "Reusable monthly report component presets.", "source": "backend/models/import-source-repository.js"}],
    ["monthly_data_format_presets", {"category": "reports", "description": "月报数据格式与清洗配置预设。", "descriptionEn": "Report data-formatting and cleaning presets.", "source": "backend/models/import-source-repository.js"}],
    ["monthly_mapping_presets", {"category": "reports", "description": "源数据字段与月报内容的映射预设。", "descriptionEn": "Source-field to report-content mapping presets.", "source": "backend/models/import-source-repository.js"}],
    ["monthly_logos", {"category": "reports", "description": "月报可选的 LOGO 图片及名称。", "descriptionEn": "Logo images and names available to reports.", "source": "backend/models/import-source-repository.js"}],
    ["reportsnapshots", {"category": "reports", "description": "报表入库历史、月份与当时保存的总分和原始数据。", "descriptionEn": "Stored report snapshots with month, historical score and original data.", "source": "backend/models/report-data-transfer-repository.js"}],
    ["reportcategoryscores", {"category": "reports", "description": "每期报表各类别的基础分、人工调整分与最终分。", "descriptionEn": "Base, manual adjustment and final scores by snapshot and category.", "source": "backend/models/report-data-transfer-repository.js"}],
    ["reportmetricdata", {"category": "reports", "description": "每期报表的指标目标、原始值、权重和计算得分。", "descriptionEn": "Snapshot metric targets, raw values, weights and calculated scores.", "source": "backend/models/report-data-transfer-repository.js"}],
    ["platformconfig", {"category": "reports", "description": "报表模块的平台配置键值。", "descriptionEn": "Platform configuration entries used by reporting.", "source": "backend/routes/db.js"}],
    ["bigscreenowners", {"category": "reports", "description": "大屏各业务维度的责任人配置。", "descriptionEn": "Owner assignments used by the reporting big screen.", "source": "backend/routes/db.js"}],
    ["slide_design_projects", {"category": "reports", "description": "胶片设计项目及保存的设计内容。", "descriptionEn": "Slide design projects and saved design content.", "source": "backend/models/slide-design-repository.js"}],
    ["slide_library_assets", {"category": "reports", "description": "胶片设计器的可复用素材库。", "descriptionEn": "Reusable slide-designer library assets.", "source": "backend/models/slide-design-repository.js"}],
    ["topic_snapshots", {"category": "reports", "description": "专题工具保存的历史业务快照。", "descriptionEn": "Historical business snapshots saved by topic tools.", "source": "backend/models/topic-snapshots-repository.js"}],
    ["topic_settings", {"category": "reports", "description": "专题工具的配置与偏好。", "descriptionEn": "Topic tool configuration and preferences.", "source": "backend/models/topic-snapshots-repository.js"}],
    ["auth_users", {"category": "auth", "description": "平台账号、角色与密码哈希。", "descriptionEn": "Platform accounts, roles and password hashes.", "source": "backend/models/auth-users-repository.js"}],
    ["auth_sessions", {"category": "auth", "description": "登录会话及有效期，供鉴权使用。", "descriptionEn": "Login sessions and expiry used for authentication.", "source": "backend/models/auth-sessions-repository.js"}],
    ["tenants", {"category": "auth", "description": "租户注册、状态与管理信息。", "descriptionEn": "Tenant registration, status and management metadata.", "source": "backend/models/tenants-repository.js"}],
    ["auth_login_attempts", {"category": "auth", "description": "登录尝试与认证安全监测记录。", "descriptionEn": "Login attempts used by authentication security monitoring.", "source": "backend/models/auth-security-monitor.js"}],
    ["auth_security_alert_state", {"category": "auth", "description": "登录安全告警状态及告警去重信息。", "descriptionEn": "Authentication security alert state and deduplication.", "source": "backend/models/auth-security-monitor.js"}],
    ["auth_security_locks", {"category": "auth", "description": "账号或来源的安全锁定状态。", "descriptionEn": "Security lock state for accounts or request sources.", "source": "backend/models/auth-security-monitor.js"}],
    ["desktop_license_requests", {"category": "auth", "description": "桌面授权申请与处理状态。", "descriptionEn": "Desktop license requests and processing status.", "source": "backend/models/desktop-license-requests-repository.js"}],
    ["ai_chat_sessions", {"category": "ai", "description": "平台 AI 助手的会话配置与会话信息。", "descriptionEn": "Platform AI assistant sessions and configuration.", "source": "backend/models/ai-chat-repository.js"}],
    ["ai_chat_messages", {"category": "ai", "description": "平台 AI 助手会话中的消息记录。", "descriptionEn": "Messages in platform AI assistant sessions.", "source": "backend/models/ai-chat-repository.js"}],
    ["ai_question_suggestions", {"category": "ai", "description": "AI 助手推荐或维护的提问建议。", "descriptionEn": "Suggested questions maintained for the AI assistant.", "source": "backend/models/ai-chat-repository.js"}],
    ["ai_usage_daily", {"category": "ai", "description": "按日汇总的 AI 调用用量。", "descriptionEn": "Daily aggregated AI usage.", "source": "backend/models/ai-usage-repository.js"}],
    ["ai_usage_daily_models", {"category": "ai", "description": "按日及模型统计的 AI 用量。", "descriptionEn": "Daily AI usage broken down by model.", "source": "backend/models/ai-usage-repository.js"}],
    ["agent_session_transcripts", {"category": "ai", "description": "智能体工具调用与会话转录。", "descriptionEn": "Agent tool-call and session transcripts.", "source": "backend/models/agent-transcript-repository.js"}],
    ["agent_session_owners", {"category": "ai", "description": "智能体会话与所有者的对应关系。", "descriptionEn": "Ownership assignments for agent sessions.", "source": "backend/models/agent-transcript-repository.js"}],
    ["agent_session_turns", {"category": "ai", "description": "智能体会话各轮次的执行状态与信息。", "descriptionEn": "Execution state and metadata for individual agent turns.", "source": "backend/models/agent-transcript-repository.js"}],
    ["agent_change_snapshots", {"category": "ai", "description": "智能体修改文件前后的变更快照。", "descriptionEn": "Snapshots of file changes made by agents.", "source": "backend/models/agent-change-repository.js"}],
    ["agent_skills", {"category": "ai", "description": "平台智能体可使用的技能定义。", "descriptionEn": "Skill definitions available to platform agents.", "source": "backend/models/agent-skills-store.js"}],
    ["agent_skill_overrides", {"category": "ai", "description": "对内置智能体技能的覆盖配置。", "descriptionEn": "Overrides for built-in agent skill definitions.", "source": "backend/models/agent-skills-store.js"}],
    ["ai_knowledge_documents", {"category": "knowledge", "description": "已索引文档的路径、内容指纹和索引时间。", "descriptionEn": "Indexed document paths, content hashes and indexing times.", "source": "backend/models/ai-knowledge-service.js"}],
    ["ai_knowledge_chunks", {"category": "knowledge", "description": "AI 检索使用的文档分块、行号与检索文本。", "descriptionEn": "Document chunks, source lines and searchable text for AI retrieval.", "source": "backend/models/ai-knowledge-service.js"}],
    ["ai_knowledge_meta", {"category": "knowledge", "description": "知识索引的状态及辅助元数据。", "descriptionEn": "Knowledge index state and supporting metadata.", "source": "backend/models/ai-knowledge-service.js"}],
    ["chat_sources", {"category": "chat", "description": "导入聊天记录的文件或其他来源信息。", "descriptionEn": "Files and other sources of imported chat history.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_conversations", {"category": "chat", "description": "聊天记录中心的会话清单与会话信息。", "descriptionEn": "Conversation inventory and metadata in Chat History.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_messages", {"category": "chat", "description": "导入聊天会话的消息正文及时间等信息。", "descriptionEn": "Imported chat messages with message content and timestamps.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_user_settings", {"category": "chat", "description": "聊天记录中心的用户级显示与使用偏好。", "descriptionEn": "User-level Chat History preferences.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_user_states", {"category": "chat", "description": "聊天记录中心保存的用户界面状态。", "descriptionEn": "Persisted Chat History user interface state.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_group_preferences", {"category": "chat", "description": "聊天群组的显示或分析偏好。", "descriptionEn": "Per-group display and analysis preferences.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_analytics_state", {"category": "chat", "description": "聊天分析任务的执行状态。", "descriptionEn": "Execution state of chat analytics tasks.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_analytics_cache", {"category": "chat", "description": "聊天分析结果缓存。", "descriptionEn": "Cached results of chat analytics.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_favorites", {"category": "chat", "description": "用户收藏的聊天消息或内容。", "descriptionEn": "User favorites from chat content.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_person_directory", {"category": "chat", "description": "聊天参与人员目录与身份信息。", "descriptionEn": "Directory and identity metadata for chat participants.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_parser_exclusion_rules", {"category": "chat", "description": "聊天文件解析时使用的排除规则。", "descriptionEn": "Exclusion rules used while parsing imported chat files.", "source": "backend/models/chat-history-repository.js"}],
    ["chat_messages_fts", {"category": "chat", "description": "聊天消息全文检索的虚拟索引表。", "descriptionEn": "Virtual full-text search index for chat messages.", "source": "backend/models/chat-history-repository.js"}],
    ["channel_sessions", {"category": "channels", "description": "外部消息渠道的连接会话与状态。", "descriptionEn": "Connection sessions and state for external messaging channels.", "source": "backend/models/channels/channel-targets-repository.js"}],
    ["channel_targets", {"category": "channels", "description": "消息发送目标、联系人或群组的配置。", "descriptionEn": "Configuration for message targets, contacts and groups.", "source": "backend/models/channels/channel-targets-repository.js"}],
    ["channel_messages", {"category": "channels", "description": "渠道消息的收发记录与处理状态。", "descriptionEn": "Channel message delivery history and processing state.", "source": "backend/models/channels/channel-targets-repository.js"}],
    ["channel_followups", {"category": "channels", "description": "催办任务的目标、进度与计划。", "descriptionEn": "Follow-up task targets, progress and schedules.", "source": "backend/models/channels/channel-followups-repository.js"}],
    ["channel_followup_events", {"category": "channels", "description": "催办任务的事件与执行历史。", "descriptionEn": "Events and execution history for follow-up tasks.", "source": "backend/models/channels/channel-followups-repository.js"}],
    ["channel_conversation_segments", {"category": "channels", "description": "渠道会话中用于跟进分析的消息分段。", "descriptionEn": "Channel conversation segments used for follow-up analysis.", "source": "backend/models/channels/channel-followups-repository.js"}],
    ["dk_meta", {"category": "datacom", "description": "数通知识库版本和辅助元数据。", "descriptionEn": "Datacom knowledge version and supporting metadata.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_domains", {"category": "datacom", "description": "数通知识库的领域分类。", "descriptionEn": "Domains in the Datacom knowledge base.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_categories", {"category": "datacom", "description": "数通知识库的文章类别。", "descriptionEn": "Article categories in the Datacom knowledge base.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_articles", {"category": "datacom", "description": "数通知识库文章正文、属性与修订版本。", "descriptionEn": "Datacom article content, attributes and revisions.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_outline", {"category": "datacom", "description": "数通知识库的知识大纲。", "descriptionEn": "Knowledge outlines for Datacom articles.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_article_revisions", {"category": "datacom", "description": "数通知识文章的历史修订。", "descriptionEn": "Historical revisions of Datacom knowledge articles.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_preferences", {"category": "datacom", "description": "数通知识库界面与内容偏好。", "descriptionEn": "Datacom knowledge interface and content preferences.", "source": "backend/models/datacom-knowledge-repository.js"}],
    ["dk_annotations", {"category": "datacom", "description": "数通知识学习过程中的批注与 AI 说明。", "descriptionEn": "Annotations and AI notes for Datacom learning.", "source": "backend/models/datacom-knowledge-ai.js"}],
    ["meeting_attendance_snapshots", {"category": "operations", "description": "会议考勤工具保存的统计快照。", "descriptionEn": "Statistical snapshots from the meeting attendance tool.", "source": "backend/models/meeting-snapshots-repository.js"}],
    ["operation_incentive_snapshots", {"category": "operations", "description": "操作激励工具保存的统计快照。", "descriptionEn": "Statistical snapshots from the operation incentive tool.", "source": "backend/models/operation-incentive-snapshots-repository.js"}],
    ["department_reward_penalty_items", {"category": "operations", "description": "部门奖惩、负向事件及其处理记录。", "descriptionEn": "Department reward, penalty and negative-event records.", "source": "backend/models/department-reward-penalty-repository.js"}],
    ["department_reward_penalty_audit", {"category": "operations", "description": "部门奖惩记录的操作审计。", "descriptionEn": "Change audit for department reward and penalty records.", "source": "backend/models/department-reward-penalty-repository.js"}],
    ["department_reward_penalty_security", {"category": "operations", "description": "奖惩工具的安全配置。", "descriptionEn": "Security configuration for the reward and penalty tool.", "source": "backend/models/department-reward-penalty-repository.js"}],
    ["reward_program_rules", {"category": "operations", "description": "正向激励申报规则。", "descriptionEn": "Rules for positive incentive applications.", "source": "backend/models/reward-program-repository.js"}],
    ["reward_program_applications", {"category": "operations", "description": "正向激励申报及审批信息。", "descriptionEn": "Positive incentive applications and review metadata.", "source": "backend/models/reward-program-repository.js"}],
    ["reward_program_events", {"category": "operations", "description": "激励申报处理过程中的事件历史。", "descriptionEn": "Event history during incentive application processing.", "source": "backend/models/reward-program-repository.js"}],
    ["reward_program_objections", {"category": "operations", "description": "激励申报的异议与反馈。", "descriptionEn": "Objections and feedback on incentive applications.", "source": "backend/models/reward-program-repository.js"}],
    ["duty_rosters", {"category": "operations", "description": "值班排班与相关设置。", "descriptionEn": "Duty rosters and related settings.", "source": "backend/models/duty-roster-repository.js"}],
    ["frt_snapshots", {"category": "operations", "description": "FRT 工具保存的业务快照。", "descriptionEn": "Business snapshots saved by the FRT tool.", "source": "backend/models/frt-snapshots-repository.js"}],
    ["praudit_configs", {"category": "operations", "description": "PR 审计工具的规则及配置。", "descriptionEn": "Rules and configuration for the PR audit tool.", "source": "backend/models/praudit-configs-repository.js"}],
    ["product_scope_dataset", {"category": "operations", "description": "产品范围工具保存的产品数据集。", "descriptionEn": "Product dataset used by the product scope tool.", "source": "backend/models/product-scope-repository.js"}],
    ["uiv_scripts", {"category": "tools", "description": "UIVF12 脚本仓库中的脚本及属性。", "descriptionEn": "Scripts and metadata in the UIVF12 repository.", "source": "backend/models/uiv-scripts-repository.js"}],
    ["uiv_categories", {"category": "tools", "description": "UIVF12 脚本类别与排序。", "descriptionEn": "UIVF12 script categories and ordering.", "source": "backend/models/uiv-categories-repository.js"}],
    ["f12_script_presets", {"category": "tools", "description": "F12 脚本配置预设。", "descriptionEn": "F12 script configuration presets.", "source": "backend/models/f12-script-presets-repository.js"}],
    ["custom_tools", {"category": "tools", "description": "自定义和内置工具的安装注册信息。", "descriptionEn": "Installation registry for custom and built-in tools.", "source": "backend/models/custom-tools-repository.js"}],
    ["custom_tools_snapshots", {"category": "tools", "description": "自定义工具保存的业务快照。", "descriptionEn": "Business snapshots saved by custom tools.", "source": "backend/models/custom-tools-snapshots-repository.js"}],
    ["tool_market_settings", {"category": "tools", "description": "多源工具市场的配置。", "descriptionEn": "Configuration for multi-source tool marketplaces.", "source": "backend/models/custom-tools-market-service.js"}],
    ["python_scripts", {"category": "tools", "description": "平台保存的 Python 脚本及元数据。", "descriptionEn": "Python scripts and metadata stored on the platform.", "source": "backend/models/python-script-repository.js"}],
    ["python_script_versions", {"category": "tools", "description": "Python 脚本的历史版本。", "descriptionEn": "Historical versions of Python scripts.", "source": "backend/models/python-script-repository.js"}],
    ["audit_log", {"category": "system", "description": "平台业务操作的审计日志。", "descriptionEn": "Audit log for platform business operations.", "source": "backend/models/audit-log-repository.js"}],
    ["alert_center_events", {"category": "system", "description": "告警中心的告警事件与处理状态。", "descriptionEn": "Alert Center events and handling state.", "source": "backend/models/alert-center-repository.js"}],
    ["service_status_daily", {"category": "system", "description": "接口或服务按日汇总的请求与耗时指标。", "descriptionEn": "Daily request and latency metrics by service or endpoint.", "source": "backend/models/service-status-repository.js"}],
    ["service_status_failures", {"category": "system", "description": "失败接口请求的诊断记录。", "descriptionEn": "Diagnostic records for failed service requests.", "source": "backend/models/service-status-repository.js"}],
    ["service_runtime_logs", {"category": "system", "description": "平台服务运行日志。", "descriptionEn": "Platform service runtime logs.", "source": "backend/models/service-status-repository.js"}],
    ["config_fingerprints", {"category": "system", "description": "配置指纹，用于识别业务配置变化。", "descriptionEn": "Configuration fingerprints used to detect business setting changes.", "source": "backend/models/config-change-monitor.js"}],
    ["sys_dictionaries", {"category": "system", "description": "平台翻译等字典键值。", "descriptionEn": "Platform translation and other dictionary entries.", "source": "backend/models/sla-prefs-repository.js"}],
    ["sys_kv_store", {"category": "system", "description": "按分类保存的通用平台配置键值。", "descriptionEn": "Generic platform configuration entries organized by category.", "source": "backend/models/kv-store.js"}],
    ["platform_usage_daily", {"category": "system", "description": "平台工具打开量等每日使用统计。", "descriptionEn": "Daily platform usage counts such as tool opens.", "source": "backend/models/platform-metrics-repository.js"}],
    ["platform_promotion_clicks", {"category": "system", "description": "首页推广内容的点击记录。", "descriptionEn": "Click records for homepage promotional content.", "source": "backend/models/platform-promotion-clicks-repository.js"}],
    ["recent_nav_tools", {"category": "system", "description": "用户最近访问的工具与导航记录。", "descriptionEn": "Recent tool visits and navigation history.", "source": "backend/models/recent-nav-repository.js"}],
    ["desktop_pet_quota_samples", {"category": "system", "description": "桌面宠物展示的额度或用量历史采样。", "descriptionEn": "Historical usage or quota samples used by the desktop pet.", "source": "backend/models/pet-quota-history-repository.js"}],
    ["desktop_pet_stories", {"category": "system", "description": "桌面宠物展示的故事内容。", "descriptionEn": "Story content displayed by the desktop pet.", "source": "backend/models/pet-stories-repository.js"}],
    ["snapshot_publish_settings", {"category": "publish", "description": "静态快照发布目标、加密与定时发布设置。", "descriptionEn": "Static snapshot publishing targets, encryption and scheduling settings.", "source": "backend/models/snapshot-publish-service.js"}],
    ["snapshot_tool_settings", {"category": "publish", "description": "按工具保存的静态发布配置。", "descriptionEn": "Per-tool static publishing configuration.", "source": "backend/models/snapshot-publish-service.js"}],
    ["snapshot_publish_jobs", {"category": "publish", "description": "静态快照发布任务及进度、日志和产物信息。", "descriptionEn": "Snapshot publishing jobs, progress, logs and output metadata.", "source": "backend/models/snapshot-publish-service.js"}],
    ["snapshot_portal_keys", {"category": "publish", "description": "静态快照门户的访问密钥配置。", "descriptionEn": "Access key configuration for snapshot portals.", "source": "backend/models/snapshot-portal-security.js"}],
    ["survey_templates", {"category": "surveys", "description": "问卷模板、题目及配置。", "descriptionEn": "Survey templates, questions and settings.", "source": "backend/models/survey-repository.js"}],
    ["survey_submissions", {"category": "surveys", "description": "已提交的问卷回答与提交信息。", "descriptionEn": "Submitted survey responses and submission metadata.", "source": "backend/models/survey-repository.js"}],
    ["requirements", {"category": "surveys", "description": "需求广场中的需求内容、状态与负责人。", "descriptionEn": "Requirements with content, workflow state and assignees.", "source": "backend/routes/requirements.js"}],
    ["requirementlogs", {"category": "surveys", "description": "需求状态流转、备注与操作历史。", "descriptionEn": "Requirement state transitions, notes and operation history.", "source": "backend/routes/requirements.js"}],
    ["warehouse_state", {"category": "warehouse", "description": "仓储工具保存的仓储业务状态与修订。", "descriptionEn": "Persisted warehouse business state and revision.", "source": "backend/models/ezscan-warehouse-repository.js"}],
]);

function describeTable(name) {
    const key = String(name).toLowerCase();
    let definition = DEFINITIONS.get(key);
    if (!definition && /^chat_messages_fts_/.test(key)) definition = {
        category: 'chat', description: '聊天全文检索的 SQLite 内部辅助表，由全文索引自动维护。',
        descriptionEn: 'SQLite full-text search shadow table maintained by the chat search index.', source: 'backend/models/chat-history-repository.js'
    };
    if (!definition) return {
        name, category: 'other', categoryLabel: '扩展与历史表', categoryLabelEn: 'Extensions & Legacy',
        description: '当前代码尚未登记此表的业务用途；请查看字段结构与建表语句。',
        descriptionEn: 'The current code does not document this table yet; inspect its columns and CREATE statement.',
        documented: false, source: null
    };
    const labels = GROUPS[definition.category];
    return { name, ...definition, categoryLabel: labels[0], categoryLabelEn: labels[1], documented: true };
}

module.exports = { describeTable };
