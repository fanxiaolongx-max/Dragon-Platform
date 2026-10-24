// Explorer navigation and table documentation. Database requests stay in the
// page's tenant-aware request functions; this layer only manages the workspace.
window.ExplorerWorkspace = (() => {
    let module = 'sql';
    let tables = [];
    let selectedTable = '';
    let tableData = null;
    let view = 'schema';
    let initialized = false;
    const byId = id => document.getElementById(id);
    const text = (zh, en) => tText(zh, en);
    const localized = (item, key) => currentLang === 'en' ? item[key + 'En'] : item[key];
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const THEME_KEY = 'tools_db_explorer_theme';

    function setTheme(value, persist = true) {
        const theme = value === 'dark' ? 'dark' : 'light';
        document.documentElement.dataset.explorerTheme = theme;
        byId('explorer-theme').value = theme;
        if (persist) {
            try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* Preferences may be unavailable in private browsers. */ }
        }
    }

    function renderHeading() {
        const metadata = tables.find(table => table.name === selectedTable);
        const names = { sql: text('SQL 终端', 'SQL Console'), tables: text('数据表查看', 'Tables'), logs: text('日志收集', 'Collect Logs') };
        byId('workspace-eyebrow').textContent = names[module];
        byId('workspace-title').textContent = module === 'tables' && metadata ? metadata.name : names[module];
        byId('workspace-description').textContent = module === 'tables'
            ? metadata ? localized(metadata, 'description') : text('从左侧完整表目录中选择一张表，查看用途、字段结构或数据。', 'Choose a table from the complete catalog to inspect its purpose, columns and data.')
            : module === 'logs' ? text('按日期收集当前后端服务的运行与错误日志。', 'Collect runtime and error logs from the backend service by date.')
                : text('从左侧选择常用示例，或在这里编写 SQL。查询在所选数据库中执行。', 'Choose an example on the left or write SQL here. Queries run in the selected database.');
        byId('table-description').textContent = metadata ? localized(metadata, 'categoryLabel') + ' · ' + localized(metadata, 'description') : '';
    }

    function setModule(next) {
        if (!['sql', 'tables', 'logs'].includes(next)) return;
        module = next;
        document.querySelectorAll('.nav-module').forEach(section => {
            section.hidden = section.dataset.module !== module;
        });
        document.querySelectorAll('.primary-module').forEach(button => {
            button.classList.toggle('active', button.dataset.targetModule === module);
            button.setAttribute('aria-current', button.dataset.targetModule === module ? 'page' : 'false');
        });
        for (const key of ['sql', 'tables', 'logs']) byId('workspace-' + key).hidden = key !== module;
        renderHeading();
    }

    function renderCatalog() {
        const query = byId('table-search').value.trim().toLowerCase();
        const matches = tables.filter(table => [table.name, table.description, table.descriptionEn, table.categoryLabel, table.categoryLabelEn].join(' ').toLowerCase().includes(query));
        byId('catalog-count').textContent = query ? `${matches.length}/${tables.length}` : String(tables.length);
        const root = byId('table-catalog');
        root.replaceChildren();
        const groups = new Map();
        for (const table of matches) {
            if (!groups.has(table.category)) groups.set(table.category, []);
            groups.get(table.category).push(table);
        }
        for (const items of groups.values()) {
            const heading = document.createElement('div');
            heading.className = 'catalog-group-label';
            heading.textContent = `${localized(items[0], 'categoryLabel')} · ${items.length}`;
            root.append(heading);
            for (const table of items) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'sidebar-item table-catalog-item';
                button.dataset.table = table.name;
                button.classList.toggle('active', table.name === selectedTable);
                button.setAttribute('aria-current', table.name === selectedTable ? 'true' : 'false');
                const name = document.createElement('strong');
                name.textContent = table.name;
                const description = document.createElement('small');
                description.textContent = localized(table, 'description');
                button.title = table.name + '\n' + description.textContent;
                button.append(name, description);
                button.onclick = () => selectTable(table.name);
                root.append(button);
            }
        }
        if (!matches.length) {
            const empty = document.createElement('p');
            empty.className = 'catalog-empty';
            empty.textContent = tables.length ? text('没有匹配的表，可按表名或用途搜索。', 'No matching tables. Search by name or purpose.') : text('此库暂无数据表。', 'No tables in this database.');
            root.append(empty);
        }
    }

    function exampleNotes() {
        document.querySelectorAll('.sql-presets .preset-pill').forEach(button => {
            let note = button.querySelector('.preset-note');
            if (!note) { note = document.createElement('small'); note.className = 'preset-note'; button.append(note); }
            const required = (button.dataset.tables || '').split(/\s+/).filter(Boolean);
            const known = required.map(name => tables.find(table => table.name === name)).filter(Boolean);
            note.textContent = required.length
                ? known.length ? known.map(item => localized(item, 'description')).join(' ') : text('所选库中没有此示例需要的表。', 'Required tables are absent from this database.')
                : /type=.*index/.test(button.dataset.sql) ? text('查看当前库的索引名称、所属表与定义。', 'List index names, owner tables and definitions.')
                    : /name, sql/.test(button.dataset.sql) ? text('查看当前库所有表的建表语句。', 'Inspect CREATE statements for all tables.')
                        : text('列出当前库的全部数据表。', 'List every table in this database.');
            button.title = [button.dataset.sql, note.textContent].join('\n');
        });
        filterExamples();
    }

    function filterExamples() {
        const query = byId('sql-example-search').value.trim().toLowerCase();
        document.querySelectorAll('.sql-presets-bar').forEach(group => {
            const buttons = [...group.querySelectorAll('.preset-pill')];
            for (const button of buttons) button.hidden = ![button.textContent, button.dataset.sql].join(' ').toLowerCase().includes(query);
            group.hidden = buttons.length > 0 && (buttons.every(button => button.hidden) || (selectedDatabase !== 'tools' && buttons.every(button => button.dataset.tables && button.disabled)));
        });
    }

    function selectTable(name) {
        if (!tables.some(table => table.name === name)) return;
        selectedTable = name;
        tableData = null;
        byId('table-select').value = name;
        byId('table-schema-view').replaceChildren();
        setModule('tables');
        setTableView('schema');
        renderCatalog();
        revealSelectedTable();
        return loadTableData(true);
    }

    function revealSelectedTable() {
        const button = [...byId('table-catalog').querySelectorAll('button')].find(item => item.dataset.table === selectedTable);
        if (!button) return;
        const container = button.closest('.module-children');
        const bounds = container.getBoundingClientRect();
        const row = button.getBoundingClientRect();
        if (row.top < bounds.top) container.scrollTop += row.top - bounds.top;
        else if (row.bottom > bounds.bottom) container.scrollTop += row.bottom - bounds.bottom;
    }

    function setTableView(next, load = true) {
        view = next === 'data' ? 'data' : 'schema';
        for (const key of ['schema', 'data']) {
            byId('table-' + key + '-view').hidden = key !== view || !selectedTable;
            byId('table-' + key + '-tab').setAttribute('aria-selected', String(key === view));
        }
        if (load && view === 'data' && selectedTable && (!tableData || tableData.view === 'schema')) return loadTableData(true);
    }

    function grid(headers, rows) {
        return `<div class="data-table-container"><table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">${text('暂无', 'None')}</td></tr>`}</tbody></table></div>`;
    }

    function renderSchema() {
        if (!tableData) return;
        const data = tableData;
        const heading = (zh, en) => `<h3>${text(zh, en)}</h3>`;
        byId('table-schema-view').innerHTML = `<div class="schema-summary">${data.schema.length} ${text('个字段', 'columns')} · ${data.total} ${text('条记录', 'rows')} · ${(data.indexes || []).length} ${text('个索引', 'indexes')}</div>`
            + heading('字段与约束', 'Columns & Constraints')
            + grid([text('字段名', 'Column'), text('类型', 'Type'), text('主键顺序', 'Primary Key Order'), text('非空', 'Not Null'), text('默认值', 'Default')], data.schema.map(col => [col.name, col.type || '—', col.pk || '—', col.notnull ? text('是', 'Yes') : text('否', 'No'), col.dflt_value ?? '—']))
            + heading('索引', 'Indexes')
            + grid([text('索引名', 'Index'), text('字段', 'Columns'), text('唯一', 'Unique'), text('部分索引', 'Partial')], (data.indexes || []).map(index => [index.name, index.columns.map(col => col.name ?? text('表达式', 'Expression')).join(', '), index.unique ? text('是', 'Yes') : text('否', 'No'), index.partial ? text('是', 'Yes') : text('否', 'No')]))
            + heading('外键关系', 'Foreign Keys')
            + grid([text('字段', 'Column'), text('关联表', 'Referenced Table'), text('关联字段', 'Referenced Column'), text('删除规则', 'On Delete'), text('更新规则', 'On Update')], (data.foreignKeys || []).map(key => [key.from, key.table, key.to ?? text('主键', 'Primary key'), key.on_delete, key.on_update]))
            + heading('建表语句', 'CREATE Statement') + `<pre class="schema-sql">${escape(data.createSql || '')}</pre>`;
    }

    function renderTable(data) {
        selectedTable = data.table;
        tableData = data;
        renderHeading();
        renderCatalog();
        revealSelectedTable();
        renderSchema();
        setTableView(view, false);
    }

    function reset() {
        tables = [];
        selectedTable = '';
        tableData = null;
        byId('table-search').value = '';
        byId('sql-example-search').value = '';
        byId('table-schema-view').replaceChildren();
        setTableView('schema');
        renderCatalog();
        renderHeading();
    }

    function translate() {
        byId('table-search').placeholder = text('搜索表名、分类或用途…', 'Search names, categories or purposes…');
        byId('sql-example-search').placeholder = text('搜索查询示例…', 'Search query examples…');
        renderCatalog();
        renderHeading();
        renderSchema();
        exampleNotes();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        let theme = 'light';
        try { theme = localStorage.getItem(THEME_KEY) || 'light'; } catch (_) { /* Keep the default light appearance. */ }
        setTheme(theme, false);
        document.querySelectorAll('.primary-module').forEach(button => button.addEventListener('click', () => setModule(button.dataset.targetModule)));
        byId('table-search').addEventListener('input', renderCatalog);
        byId('sql-example-search').addEventListener('input', filterExamples);
        setModule('sql');
        translate();
    }

    function logRange(days) {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - days + 1);
        byId('log-from-date').value = formatDateInput(from);
        byId('log-to-date').value = formatDateInput(to);
        setModule('logs');
        document.querySelectorAll('[data-log-days]').forEach(button => button.classList.toggle('active', Number(button.dataset.logDays) === days));
    }

    return { init, translate, setTheme, setModule, setTableView, selectTable, renderTable, reset, filterExamples, logRange, getTableView: () => view,
        setCatalog(items) { tables = items; renderCatalog(); exampleNotes(); renderHeading(); },
        openEditor() { setModule('sql'); byId('sql-input').focus(); } };
})();
