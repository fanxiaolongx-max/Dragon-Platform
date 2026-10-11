/**
 * uivf12/netcare-analysis.js
 * 生成可嵌入 F12 浮窗的 NetCare 专题分析运行时。
 * 运行时通过 Function#toString 内联到复制脚本，不依赖目标站点加载本文件。
 */
(function () {
    'use strict';

    function installNetCareAnalysisRuntime(root, options) {
        const simulationMode = Boolean(options && options.simulation);
        if (!root || (!simulationMode && window.location.hostname !== 'netcare.huawei.com')) return null;

        const CONFIG = {
            officeCode: '026921', regionCode: '026902', certificateYear: '2026',
            productIncorporationYear: '2025', pageSize: 100,
            cnbgCustomers: ['Telecom Egypt', 'Orange Egypt for Telecommunications', 'Etisalat Misr', 'Vodafone Egypt'],
            customerAliases: { 'NILE ON LINE (NOL)': 'Etisalat Misr' },
            targets: { product: 30, version: 80 }
        };
        const EOS_SETTINGS_KEY = 'uivf12-netcare-eos-settings-v1';
        const LANGUAGE_KEY = 'uivf12-netcare-language-v1';
        const CHANGE_BU_KEY = 'uivf12-netcare-change-bu-v1';
        const CHANGE_PRODUCT_LINE_KEY = 'uivf12-netcare-change-product-lines-v1';
        const SR_TYPE_FILTER_KEY = 'uivf12-netcare-sr-types-v1';
        const SR_PRODUCT_LINE_KEY = 'uivf12-netcare-sr-product-lines-v1';
        const CHANGE_BU_OPTIONS = ['NIS', 'CS', 'AMS', 'NIS-ITS', 'Software', 'SEC', '专业服务', 'PS', 'NRO', '工程服务'];
        const CHANGE_PRODUCT_LINE_OPTIONS = ['data_storage', 'wireless', 'cloud_core_network', 'data_communication', 'software_business', 'optical_business', 'computing', 'service_product', 'opmt', 'digital_power'];
        const SR_PRODUCT_LINE_OPTIONS = ['wireless', 'opmt', 'digital_power', 'service_product', 'optical_business', 'computing', 'data_storage', 'cloud_core_network', 'data_communication', 'industry_consulting', 'software_business'];
        let uiLanguage = 'zh';
        try { uiLanguage = localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh'; } catch (error) {}
        function tr(zh, en) { return uiLanguage === 'en' ? en : zh; }
        function productLineLabel(value) {
            const labels = {
                data_storage: tr('数据存储', 'Data Storage'), wireless: tr('无线', 'Wireless'), cloud_core_network: tr('云核心网', 'Cloud Core Network'),
                data_communication: tr('数据通信', 'Data Communication'), software_business: tr('软件业务', 'Software Business'), optical_business: tr('光业务', 'Optical Business'),
                computing: tr('计算', 'Computing'), service_product: tr('服务产品', 'Service Product'), opmt: 'OPMT', digital_power: tr('数字能源', 'Digital Power'),
                industry_consulting: tr('行业咨询', 'Industry Consulting')
            };
            return labels[value] || value;
        }
        const API_URLS = {
            certificate: 'https://netcare.huawei.com/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_digital_certificate_l3_grid_get_list',
            eos: 'https://netcare.huawei.com/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_eos_detail_get_list',
            change: 'https://netcare.huawei.com/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_change_summary',
            highRiskInterception: 'https://netcare.huawei.com/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_change_highrisk_commands_charts_statistics',
            sr: 'https://netcare.huawei.com/adc-service/web/rest/v1/services/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_sr_problem_overview_statistics'
        };
        const SR_TYPE_NAMES = ['Technical Request-Others', 'Technical Request-POC', 'CS - Technical Request', 'Technical Request-NRO', 'Technical Request - Cross Prod.', 'Technical Request - Cross Product', 'Technical Request - Platform', 'Technical Request - Third Party', 'Technical Request - Service Delivery'];
        const SOURCE_PAGE = {
            certificate: '/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_digital_certificate_l3_grid',
            eos: '/NetCareOperationCenter/cs_nc_operation_center_extend/op_ex_eos_detail_grid'
        };
        const CERT_BODY = {
            version: CONFIG.certificateYear, metric: 'need_reduce_cnt', subnet_code: '', branch_code: '', resolution_name: '', incident_level: '',
            bg: 'CNBG,EBG', t1_operator: '', na_type: '', sr_type: '', end_date: '', start_date: '', network_id: '', office_code: CONFIG.officeCode,
            region_code: CONFIG.regionCode, product_line: '', country_code: '', network: '', customer_number: '', category_name: '', is_evolution: '',
            top_level: '', reduction_scenario: '2', risk_status: '', duetime_year: '', disposal_methods: '', task_id: '', snapshot_time: '',
            group_by: 'region_code,repoffice_code,bg'
        };
        const EOS_COMMON = {
            additional_flag: '', eos_year_flag: '', start: 0, limit: CONFIG.pageSize, bg: 'CNBG,EBG', region_code: CONFIG.regionCode,
            office_code: CONFIG.officeCode, country_code: '', network_id: '', customer_number: '', t1_operator: '', branch_code: '', subnet_code: '',
            product_line: '', product_area_code: '', product_family_code: '', product_code: '', na_type: '', risk_top_level: '', current_phase: '',
            contingency_plan_id: '', incorporation_type: '', annual_baseline: '', eos_year: '', delay_year_month: '', snapshot_time: '', kpi_type: ''
        };
        const PRODUCT_BODY = Object.assign({}, EOS_COMMON, {
            bordType: 'new_urgency_eos', data_type: 'urgency_eos', metric: 'before_urgent_incorporation_completion_rate',
            exclusion_recordal: 'after', incorporation_year: CONFIG.productIncorporationYear
        });
        const VERSION_BODY = Object.assign({}, EOS_COMMON, {
            bordType: '', data_type: 'high_risk_eos', metric: 'nc_urgent_incorporation_completion_rate', exclusion_recordal: '', incorporation_year: ''
        });

        const style = document.createElement('style');
        style.textContent = `
            .body.nc-active{display:flex;flex-direction:column;overflow:hidden}.nc-mode{display:none;min-height:0;flex:1;flex-direction:column;margin-top:11px;border:1px solid rgba(148,163,184,.2);border-radius:11px;overflow:hidden;background:rgba(2,6,23,.5)}
            .nc-mode.active{display:flex}.nc-head-button{width:auto!important;padding:0 9px!important;font-size:10px!important}.nc-head-button.active{border-color:#67e8f9!important;color:#fff!important;background:#0e7490!important}
            .nc-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-bottom:1px solid rgba(148,163,184,.17);background:rgba(15,23,42,.85)}
            .nc-tabs{display:flex;gap:5px;overflow-x:auto}.nc-toolbar-actions{display:flex;align-items:center;gap:5px}.nc-tab,.nc-refresh,.nc-language,.nc-json-button{flex:0 0 auto;padding:6px 9px;border:1px solid rgba(148,163,184,.25);border-radius:7px;background:#1e293b;color:#cbd5e1;font-size:9px;font-weight:800;cursor:pointer}.nc-tab.active{border-color:#67e8f9;background:#0e7490;color:#fff}.nc-refresh{border-color:rgba(74,222,128,.4);color:#bbf7d0}.nc-refresh:disabled,.nc-json-button:disabled{opacity:.5;cursor:not-allowed}.nc-language{min-width:34px;border-color:rgba(103,232,249,.45);color:#a5f3fc;background:#164e63}.nc-json-button{border-color:rgba(251,191,36,.42);color:#fde68a;background:rgba(120,53,15,.3)}.nc-review-badge{display:none;align-items:center;padding:5px 9px;border:1px solid #fb7185;border-radius:999px;background:linear-gradient(135deg,#9f1239,#be123c);color:#fff;font-size:9px;font-weight:950;box-shadow:0 0 16px rgba(244,63,94,.32);white-space:nowrap}.nc-review-badge.active{display:inline-flex}.nc-status.review{color:#fecdd3;background:rgba(159,18,57,.2);font-weight:800}
            .nc-status{padding:7px 10px;border-bottom:1px solid rgba(148,163,184,.12);color:#94a3b8;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nc-content{min-height:0;flex:1;overflow:auto;padding:10px}.nc-view{display:none}.nc-view.active{display:block}
            .nc-card{margin-bottom:10px;border:1px solid rgba(148,163,184,.2);border-radius:9px;overflow:hidden;background:rgba(15,23,42,.74)}.nc-card-title{display:flex;justify-content:space-between;gap:10px;padding:9px 10px;border-bottom:1px solid rgba(148,163,184,.16);color:#f8fafc;font-size:11px;font-weight:850}.nc-card-title small{color:#94a3b8;font-size:8px;font-weight:500}.nc-table-wrap{overflow:auto}.nc-table{width:max-content;min-width:100%;border-collapse:collapse;font-size:9px}.nc-table th,.nc-table td{padding:6px 7px;border-right:1px solid rgba(148,163,184,.13);border-bottom:1px solid rgba(148,163,184,.13);white-space:nowrap;text-align:center}.nc-table th{position:sticky;top:0;background:#172033;color:#bae6fd}.nc-table td{color:#cbd5e1}.nc-table .nc-name{text-align:left;font-weight:800}.nc-table .nc-child{padding-left:22px;color:#94a3b8;font-weight:500}.nc-table .nc-total td{background:rgba(14,116,144,.2);font-weight:850}.nc-table .nc-bg td{background:rgba(30,41,59,.75);font-weight:800}.nc-good{color:#86efac!important;font-weight:850}.nc-bad{color:#fca5a5!important;font-weight:850}.nc-muted{color:#64748b!important}.nc-target{color:#7dd3fc}.nc-note{padding:8px 10px;color:#64748b;font-size:8px;line-height:1.55}.nc-loading,.nc-error,.nc-empty{padding:36px 12px;text-align:center;color:#94a3b8;font-size:10px}.nc-error{color:#fca5a5}.nc-option{display:flex;align-items:center;gap:7px;margin-bottom:9px;padding:8px 10px;border:1px solid rgba(148,163,184,.2);border-radius:8px;background:rgba(15,23,42,.7);color:#cbd5e1;font-size:9px}.nc-option input{accent-color:#06b6d4}
            .nc-eos-settings{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-bottom:10px;padding:8px 10px;border:1px solid rgba(34,211,238,.24);border-radius:9px;background:rgba(8,47,73,.36);color:#bae6fd;font-size:9px}.nc-eos-settings label{display:flex;align-items:center;gap:5px}.nc-eos-settings input,.nc-eos-settings select,.nc-plan-input{box-sizing:border-box;border:1px solid rgba(148,163,184,.34);border-radius:5px;background:#0f172a;color:#f8fafc;font:inherit}.nc-eos-settings input{width:54px;padding:4px 5px;text-align:right}.nc-eos-settings select{padding:4px 6px}.nc-top-n-control{display:inline-flex;align-items:center;gap:3px}.nc-top-n-control input{width:40px!important;height:25px;padding:2px 4px!important;text-align:center!important;-moz-appearance:textfield}.nc-top-n-control input::-webkit-inner-spin-button,.nc-top-n-control input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nc-top-n-step{width:24px;height:25px;padding:0;border:1px solid rgba(251,191,36,.38);border-radius:5px;background:rgba(146,64,14,.3);color:#fde68a;font-size:12px;font-weight:900;cursor:pointer}.nc-top-n-step:hover{filter:brightness(1.2)}.nc-export-button{margin-left:auto;height:27px;padding:0 10px;border:1px solid rgba(74,222,128,.45);border-radius:6px;background:linear-gradient(135deg,rgba(22,101,52,.7),rgba(6,78,59,.72));color:#dcfce7;font-size:9px;font-weight:900;cursor:pointer;box-shadow:0 3px 10px rgba(16,185,129,.12)}.nc-export-button:hover{filter:brightness(1.14)}.nc-export-button:disabled{opacity:.55;cursor:wait}.nc-plan-control{display:inline-flex;align-items:center;justify-content:center;gap:3px}.nc-plan-input{width:48px;height:25px;padding:3px 4px;text-align:center;border-radius:4px!important;-moz-appearance:textfield}.nc-plan-input::-webkit-inner-spin-button,.nc-plan-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nc-plan-step,.nc-plan-preset,.nc-bulk-button{height:25px;border:1px solid rgba(148,163,184,.3);border-radius:5px;color:#e2e8f0;font-size:8px;font-weight:800;cursor:pointer;transition:background .15s,border-color .15s,transform .15s}.nc-plan-step{width:25px;padding:0;background:#1e293b;color:#a5f3fc;font-size:13px}.nc-plan-step:hover{border-color:#22d3ee;background:#164e63}.nc-plan-preset{padding:0 7px;background:rgba(30,64,175,.28);color:#bfdbfe;border-color:rgba(96,165,250,.38)}.nc-plan-preset[data-plan-action="all"]{background:rgba(22,101,52,.3);color:#bbf7d0;border-color:rgba(74,222,128,.38)}.nc-plan-preset[data-plan-action="clear"]{background:rgba(127,29,29,.25);color:#fecaca;border-color:rgba(248,113,113,.32)}.nc-plan-preset:hover,.nc-bulk-button:hover{filter:brightness(1.2)}.nc-plan-step:active,.nc-plan-preset:active,.nc-bulk-button:active{transform:translateY(1px)}.nc-card-title-main{display:flex;align-items:baseline;gap:8px}.nc-bulk-actions{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:4px}.nc-bulk-button{padding:0 8px;background:rgba(30,64,175,.28);color:#bfdbfe;border-color:rgba(96,165,250,.38)}.nc-bulk-button[data-bulk-action="all"]{background:rgba(22,101,52,.3);color:#bbf7d0;border-color:rgba(74,222,128,.38)}.nc-bulk-button[data-bulk-action="topn"]{background:rgba(146,64,14,.3);color:#fde68a;border-color:rgba(251,191,36,.38)}.nc-bulk-button[data-bulk-action="clear"]{background:rgba(127,29,29,.25);color:#fecaca;border-color:rgba(248,113,113,.32)}.nc-collapse-button{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-right:6px;border:1px solid rgba(103,232,249,.3);border-radius:5px;background:rgba(8,145,178,.18);color:#a5f3fc;font-size:10px;font-weight:900;cursor:pointer;vertical-align:middle;transition:background .15s,transform .15s}.nc-collapse-button:hover{background:rgba(8,145,178,.38)}.nc-collapse-button:active{transform:scale(.94)}.nc-merged-row td{background:rgba(15,23,42,.88)!important}.nc-merged-row.customer td{border-top:1px solid rgba(103,232,249,.25)}.nc-merged-row.line td{background:rgba(30,41,59,.55)!important}.nc-merged-label{color:#e2e8f0!important;text-align:left!important;font-weight:850}.nc-merged-hint{color:#64748b!important;font-size:7px}.nc-readonly-plan{color:#cbd5e1;font-weight:800}.nc-bg-divider td{background:rgba(8,47,73,.48)!important;color:#67e8f9!important;font-weight:850;text-align:left!important}.nc-customer-divider td{background:rgba(30,41,59,.68)!important;color:#e2e8f0!important;font-weight:800;text-align:left!important;padding-left:16px!important}.nc-line-divider td{background:rgba(30,41,59,.34)!important;color:#94a3b8!important;font-weight:750;text-align:left!important;padding-left:28px!important}.nc-product-divider td{color:#7dd3fc!important;font-weight:750;text-align:left!important;padding-left:40px!important}.nc-item-label{text-align:left!important;padding-left:40px!important}.nc-version-label{text-align:left!important;padding-left:52px!important}.nc-top-list{min-width:180px;max-width:300px;text-align:left;font-size:7px;line-height:1.45;color:#cbd5e1}.nc-top-customer+.nc-top-customer{margin-top:5px;padding-top:4px;border-top:1px dashed rgba(148,163,184,.2)}.nc-top-customer-title{display:block;margin-bottom:1px;color:#67e8f9;font-size:7px;font-weight:900}.nc-top-list span{display:block}.nc-top-list b{color:#f8fafc}.nc-top-empty{color:#64748b;text-align:center}.nc-eos-briefs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:-1px 0 10px}.nc-eos-brief{position:relative;padding:10px 11px 10px 14px;border:1px solid rgba(148,163,184,.18);border-radius:9px;background:linear-gradient(135deg,rgba(15,23,42,.94),rgba(8,47,73,.42));color:#cbd5e1;font-size:8px;line-height:1.7}.nc-eos-brief:before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:3px;background:#22d3ee}.nc-eos-brief.version:before{background:#a78bfa}.nc-eos-brief-title{margin-bottom:3px;color:#f8fafc;font-size:10px;font-weight:900}.nc-eos-brief p{margin:0}.nc-eos-brief p+p{margin-top:3px}.nc-eos-brief strong{color:#67e8f9;font-weight:900}.nc-eos-brief.version strong{color:#c4b5fd}.nc-eos-brief .nc-brief-focus{color:#fbbf24}.nc-eos-brief .nc-brief-good{color:#86efac}.nc-eos-brief .nc-brief-gap{color:#fca5a5}@media(max-width:760px){.nc-eos-briefs{grid-template-columns:1fr}.nc-card-title{align-items:flex-start;flex-direction:column}.nc-bulk-actions{justify-content:flex-start}.nc-export-button{margin-left:0}}
            .nc-progress-note{display:block;box-sizing:border-box;width:190px;min-width:150px;height:42px;padding:6px 7px;resize:vertical;border:1px solid rgba(56,189,248,.28);border-radius:6px;background:rgba(8,47,73,.28);color:#e2e8f0;font:inherit;line-height:1.4;white-space:pre-wrap}.nc-progress-note::placeholder{color:#64748b}.nc-progress-note:focus{outline:none;border-color:#38bdf8;background:rgba(8,47,73,.5);box-shadow:0 0 0 2px rgba(56,189,248,.1)}.nc-bulk-button[data-collapse-action]{background:rgba(88,28,135,.28);color:#e9d5ff;border-color:rgba(192,132,252,.35)}.nc-bulk-button[data-collapse-action="expand"]{background:rgba(14,116,144,.24);color:#a5f3fc;border-color:rgba(34,211,238,.32)}
            .nc-eos-table-wrap{position:relative;max-height:min(64vh,620px);overscroll-behavior:contain;scrollbar-gutter:stable}.nc-eos-detail-table th{z-index:30;box-shadow:0 2px 7px rgba(2,6,23,.42)}.nc-eos-sticky-context{position:sticky;left:0;z-index:25;height:0;pointer-events:none}.nc-eos-sticky-item{display:flex;align-items:center;box-sizing:border-box;min-height:25px;padding:4px 10px;border-bottom:1px solid rgba(148,163,184,.18);font-size:8px;font-weight:850;line-height:1.35;white-space:normal;backdrop-filter:blur(8px);box-shadow:0 3px 8px rgba(2,6,23,.26);animation:ncStickyIn .14s ease-out}.nc-eos-sticky-item.bg{background:rgba(8,47,73,.96);color:#67e8f9}.nc-eos-sticky-item.customer{padding-left:18px;background:rgba(30,41,59,.96);color:#e2e8f0}.nc-eos-sticky-item.line{padding-left:30px;background:rgba(30,41,59,.92);color:#94a3b8}.nc-eos-sticky-item.product{padding-left:42px;background:rgba(15,23,42,.94);color:#7dd3fc}.nc-table-fullscreen-button{background:rgba(67,56,202,.3)!important;color:#ddd6fe!important;border-color:rgba(167,139,250,.45)!important}.nc-eos-card.nc-eos-fullscreen{position:fixed;inset:10px;z-index:2147483646;display:flex;flex-direction:column;margin:0;border-color:rgba(103,232,249,.48);background:#020617;box-shadow:0 0 0 100vmax rgba(2,6,23,.84),0 24px 70px rgba(0,0,0,.62)}.nc-eos-card.nc-eos-fullscreen .nc-card-title{flex:0 0 auto;background:linear-gradient(135deg,#0f172a,#164e63)}.nc-eos-card.nc-eos-fullscreen .nc-eos-table-wrap{flex:1;min-height:0;max-height:none}.nc-eos-card.nc-eos-fullscreen .nc-table-fullscreen-button{background:rgba(127,29,29,.55)!important;color:#fecaca!important;border-color:rgba(248,113,113,.5)!important}.nc-eos-fullscreen-open{overflow:hidden!important}@keyframes ncStickyIn{from{opacity:.4;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
            .nc-change-filter{margin-bottom:10px;padding:10px;border:1px solid rgba(56,189,248,.25);border-radius:9px;background:linear-gradient(135deg,rgba(8,47,73,.48),rgba(15,23,42,.78))}.nc-change-filter-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.nc-change-filter-head strong{color:#f8fafc;font-size:11px}.nc-change-filter-head small{color:#94a3b8;font-size:8px}.nc-filter-row{display:grid;grid-template-columns:70px minmax(0,1fr);align-items:start;gap:7px;padding:5px 0}.nc-filter-row+.nc-filter-row{border-top:1px dashed rgba(148,163,184,.16)}.nc-filter-label{padding-top:7px;color:#7dd3fc;font-size:8px;font-weight:900}.nc-bu-controls{display:flex;align-items:center;flex-wrap:wrap;gap:5px}.nc-bu-all,.nc-bu-chip,.nc-bu-apply{height:27px;box-sizing:border-box;border:1px solid rgba(148,163,184,.28);border-radius:6px;background:#1e293b;color:#cbd5e1;font-size:8px;font-weight:800}.nc-bu-all,.nc-bu-apply{padding:0 9px;cursor:pointer}.nc-bu-all.active{border-color:#22d3ee;background:#0e7490;color:#fff}.nc-bu-chip{display:inline-flex;align-items:center;gap:4px;padding:0 8px;cursor:pointer}.nc-bu-chip:has(input:checked){border-color:#60a5fa;background:rgba(30,64,175,.55);color:#dbeafe}.nc-bu-chip input{width:11px;height:11px;margin:0;accent-color:#38bdf8}.nc-bu-apply{margin-left:auto;border-color:rgba(74,222,128,.48);background:linear-gradient(135deg,rgba(22,101,52,.7),rgba(6,78,59,.72));color:#dcfce7}.nc-bu-apply:disabled{opacity:.5;cursor:wait}.nc-bu-note{margin-top:7px;color:#64748b;font-size:8px;line-height:1.45}@media(max-width:760px){.nc-change-filter-head{align-items:flex-start;flex-direction:column}.nc-filter-row{grid-template-columns:1fr}.nc-filter-label{padding-top:0}.nc-bu-apply{margin-left:0}}
            .nc-sr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:7px;margin-bottom:10px}.nc-sr-kpi{min-height:70px;padding:10px;border:1px solid rgba(148,163,184,.18);border-radius:9px;background:linear-gradient(145deg,rgba(15,23,42,.92),rgba(30,41,59,.72))}.nc-sr-kpi-label{color:#94a3b8;font-size:8px;font-weight:750}.nc-sr-kpi-value{margin-top:5px;color:#f8fafc;font-size:19px;font-weight:900;letter-spacing:-.3px}.nc-sr-kpi-meta{margin-top:3px;color:#64748b;font-size:7px}.nc-sr-kpi.good .nc-sr-kpi-value{color:#86efac}.nc-sr-kpi.warn .nc-sr-kpi-value{color:#fbbf24}.nc-sr-kpi.bad .nc-sr-kpi-value{color:#fca5a5}.nc-sr-severity{display:flex;height:9px;margin:9px 10px 2px;border-radius:9px;overflow:hidden;background:#1e293b}.nc-sr-severity span{min-width:2px}.nc-sr-minor{background:#38bdf8}.nc-sr-major{background:#fbbf24}.nc-sr-critical{background:#f87171}.nc-sr-legend{display:flex;flex-wrap:wrap;gap:10px;padding:3px 10px 9px;color:#94a3b8;font-size:8px}.nc-sr-dot{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%}.nc-sr-section-note{padding:7px 10px;color:#64748b;font-size:8px;line-height:1.5}
            .nc-sr-analysis-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(270px,.8fr);align-items:stretch}.nc-sr-analysis-grid>.nc-table-wrap{min-width:0}.nc-sr-chart{min-width:0;padding:7px;border-left:1px solid rgba(148,163,184,.15);background:rgba(2,6,23,.24)}.nc-sr-chart svg{display:block;width:100%;height:auto;max-height:225px}.nc-sr-chart text{font-family:Arial,sans-serif}.nc-sr-chart-title{fill:#e2e8f0;font-size:9px;font-weight:700}.nc-sr-chart-axis{fill:#64748b;font-size:7px}.nc-sr-chart-value{fill:#cbd5e1;font-size:7px;font-weight:700}.nc-sr-chart-grid{stroke:rgba(148,163,184,.16);stroke-width:1}.nc-sr-chart-legend{fill:#94a3b8;font-size:7px}@media(max-width:900px){.nc-sr-analysis-grid{grid-template-columns:1fr}.nc-sr-chart{border-top:1px solid rgba(148,163,184,.15);border-left:0}}
        `;
        root.appendChild(style);

        const headActions = root.querySelector('.head-actions');
        const body = root.querySelector('.body');
        const notice = root.querySelector('.notice');
        const status = root.querySelector('.status');
        const actions = root.querySelector('.actions');
        const results = root.querySelector('.results');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fullscreen nc-head-button';
        button.textContent = tr('NetCare 专题', 'NetCare Insights');
        button.title = tr('打开 NetCare 专题分析', 'Open NetCare insights');
        headActions.insertBefore(button, headActions.firstChild);

        const mode = document.createElement('section');
        mode.className = 'nc-mode';
        mode.innerHTML = `
            <div class="nc-toolbar">
                <div class="nc-tabs">
                    <button class="nc-tab active" data-view="eos">${tr('EOS 收编', 'EOS Incorporation')}</button>
                    <button class="nc-tab" data-view="cert">${tr('证书清理', 'Certificate Cleanup')}</button>
                    <button class="nc-tab" data-view="change">${tr('变更数量', 'Change Volume')}</button>
                    <button class="nc-tab" data-view="interception">${tr('高危拦截', 'High-risk Interception')}</button>
                    <button class="nc-tab" data-view="sr">${tr('SR 问题单', 'SR Tickets')}</button>
                </div>
                <div class="nc-toolbar-actions"><span class="nc-review-badge"></span><button class="nc-json-button nc-json-export" type="button" disabled>${tr('导出 JSON', 'Export JSON')}</button><button class="nc-json-button nc-json-import" type="button">${tr('导入 JSON', 'Import JSON')}</button><input class="nc-json-file" type="file" accept="application/json,.json" hidden><button class="nc-refresh" type="button">${tr('刷新专题', 'Refresh')}</button><button class="nc-language" type="button" title="${tr('切换为英文', 'Switch to Chinese')}">${uiLanguage === 'zh' ? 'EN' : '中'}</button></div>
            </div>
            <div class="nc-status">${tr('专题尚未加载', 'Insights not loaded')}</div>
            <div class="nc-content">
                <section class="nc-view active" data-view-panel="eos"><div class="nc-empty">${tr('进入专题后点击“刷新专题”获取数据', 'Click “Refresh” to load insights')}</div></section>
                <section class="nc-view" data-view-panel="cert"></section>
                <section class="nc-view" data-view-panel="change"></section>
                <section class="nc-view" data-view-panel="interception"></section>
                <section class="nc-view" data-view-panel="sr"></section>
            </div>`;
        body.appendChild(mode);
        const refreshButton = mode.querySelector('.nc-refresh');
        const languageButton = mode.querySelector('.nc-language');
        const jsonExportButton = mode.querySelector('.nc-json-export');
        const jsonImportButton = mode.querySelector('.nc-json-import');
        const jsonFileInput = mode.querySelector('.nc-json-file');
        const reviewBadge = mode.querySelector('.nc-review-badge');
        const modeStatus = mode.querySelector('.nc-status');
        if (simulationMode) { refreshButton.disabled = true; refreshButton.title = tr('模拟浮窗仅支持导入历史 JSON，不访问正式接口', 'Simulation only imports historical JSON and never calls live APIs'); modeStatus.textContent = tr('模拟浮窗：请点击“导入 JSON”离线回顾正式站点导出的专题数据', 'Simulation: import a topic JSON exported from the live site for offline review'); }
        const views = {};
        mode.querySelectorAll('[data-view-panel]').forEach(view => { views[view.dataset.viewPanel] = view; });
        let active = false;
        let loaded = false;
        let loading = false;
        let destroyed = false;
        let interceptionDistinguishBG = true;
        let dashboardCache = null;
        let capturedAt = null;
        let reviewInfo = null;
        let liveSettingsBeforeReview = null;
        let changeLoading = false;
        let srLoading = false;
        let eosFullscreenType = null;
        let changeBuSelection = [];
        let changeProductLineSelection = [];
        let srTypeSelection = [];
        let srProductLineSelection = [];
        try {
            const savedBus = JSON.parse(localStorage.getItem(CHANGE_BU_KEY) || '[]');
            if (Array.isArray(savedBus)) changeBuSelection = CHANGE_BU_OPTIONS.filter(value => savedBus.includes(value));
        } catch (error) {}
        function saveChangeBuSelection() {
            if (reviewInfo) return;
            try { localStorage.setItem(CHANGE_BU_KEY, JSON.stringify(changeBuSelection)); } catch (error) {}
        }
        try {
            const savedProductLines = JSON.parse(localStorage.getItem(CHANGE_PRODUCT_LINE_KEY) || '[]');
            if (Array.isArray(savedProductLines)) changeProductLineSelection = CHANGE_PRODUCT_LINE_OPTIONS.filter(value => savedProductLines.includes(value));
        } catch (error) {}
        function saveChangeProductLineSelection() {
            if (reviewInfo) return;
            try { localStorage.setItem(CHANGE_PRODUCT_LINE_KEY, JSON.stringify(changeProductLineSelection)); } catch (error) {}
        }
        try {
            const savedSrTypes = JSON.parse(localStorage.getItem(SR_TYPE_FILTER_KEY) || '[]');
            if (Array.isArray(savedSrTypes)) srTypeSelection = SR_TYPE_NAMES.filter(value => savedSrTypes.includes(value));
        } catch (error) {}
        function saveSrTypeSelection() {
            if (reviewInfo) return;
            try { localStorage.setItem(SR_TYPE_FILTER_KEY, JSON.stringify(srTypeSelection)); } catch (error) {}
        }
        try {
            const savedProductLines = JSON.parse(localStorage.getItem(SR_PRODUCT_LINE_KEY) || '[]');
            if (Array.isArray(savedProductLines)) srProductLineSelection = SR_PRODUCT_LINE_OPTIONS.filter(value => savedProductLines.includes(value));
        } catch (error) {}
        function saveSrProductLineSelection() {
            if (reviewInfo) return;
            try { localStorage.setItem(SR_PRODUCT_LINE_KEY, JSON.stringify(srProductLineSelection)); } catch (error) {}
        }

        function loadEosSettings() {
            const fallback = { targets: { product: CONFIG.targets.product, version: CONFIG.targets.version }, topN: { product: 3, version: 3 }, sortMode: 'quantity-desc', plans: { product: {}, version: {} }, notes: { product: {}, version: {} }, collapsed: {} };
            try {
                const saved = JSON.parse(localStorage.getItem(EOS_SETTINGS_KEY) || 'null');
                if (!saved || typeof saved !== 'object') return fallback;
                for (const type of ['product', 'version']) {
                    const target = Number(saved.targets && saved.targets[type]);
                    if (Number.isFinite(target) && target >= 0 && target <= 100) fallback.targets[type] = target;
                    if (saved.plans && saved.plans[type] && typeof saved.plans[type] === 'object') fallback.plans[type] = saved.plans[type];
                    if (saved.notes && saved.notes[type] && typeof saved.notes[type] === 'object') fallback.notes[type] = saved.notes[type];
                }
                if (saved.topN && typeof saved.topN === 'object') {
                    for (const type of ['product', 'version']) { const value = Math.floor(num(saved.topN[type])); if (value >= 1 && value <= 99) fallback.topN[type] = value; }
                } else {
                    const legacyTopN = Math.floor(num(saved.topN));
                    if (legacyTopN >= 1 && legacyTopN <= 99) fallback.topN = { product: legacyTopN, version: legacyTopN };
                }
                if (['quantity-desc', 'rate-asc'].includes(saved.sortMode)) fallback.sortMode = saved.sortMode;
                if (saved.collapsed && typeof saved.collapsed === 'object') fallback.collapsed = saved.collapsed;
            } catch (error) {}
            return fallback;
        }
        const eosSettings = loadEosSettings();
        function saveEosSettings() {
            if (reviewInfo) return;
            try { localStorage.setItem(EOS_SETTINGS_KEY, JSON.stringify(eosSettings)); } catch (error) {}
        }

        function setMode(nextActive) {
            active = nextActive;
            if (!active) {
                eosFullscreenType = null;
                document.body.classList.remove('nc-eos-fullscreen-open');
                applyEosFullscreen();
            }
            button.classList.toggle('active', active);
            body.classList.toggle('nc-active', active);
            button.textContent = active ? tr('返回 CSV', 'Back to CSV') : tr('NetCare 专题', 'NetCare Insights');
            mode.classList.toggle('active', active);
            [notice, status, actions, results].forEach(element => {
                if (!element) return;
                if (active) { element.dataset.ncPreviousDisplay = element.style.display || ''; element.style.display = 'none'; }
                else { element.style.display = element.dataset.ncPreviousDisplay || ''; delete element.dataset.ncPreviousDisplay; }
            });
            if (active && !loaded && !loading && !simulationMode) loadDashboard();
        }
        button.addEventListener('click', function () {
            if (!active && options && typeof options.isCaptureActive === 'function' && options.isCaptureActive()) {
                modeStatus.textContent = tr('CSV 正在抓取，请完成后再进入 NetCare 专题。', 'CSV capture is running. Finish it before opening NetCare insights.');
                return;
            }
            setMode(!active);
        });
        mode.querySelectorAll('.nc-tab').forEach(tab => {
            tab.addEventListener('click', function () {
                mode.querySelectorAll('.nc-tab').forEach(item => item.classList.toggle('active', item === tab));
                Object.keys(views).forEach(key => views[key].classList.toggle('active', key === tab.dataset.view));
            });
        });
        function dashboardStatus(result) {
            return tr('更新于 ', 'Updated at ') + new Date().toLocaleTimeString(uiLanguage === 'en' ? 'en-GB' : 'zh-CN', { hour12: false })
                + tr(' · 证书 ', ' · Certificates ') + result[0].length + tr(' · 产品 ', ' · Products ') + result[1].length
                + tr(' · 版本 ', ' · Versions ') + result[2].length + tr(' · 变更 ', ' · Changes ') + result[3].rows.length
                + tr(' · 拦截 ', ' · Interceptions ') + result[4].rows.length + tr(' · SR ', ' · SR ') + result[5].summary.length;
        }
        function snapshotCounts(result) {
            return tr('证书 ', 'Certificates ') + result[0].length + tr(' · 产品 ', ' · Products ') + result[1].length
                + tr(' · 版本 ', ' · Versions ') + result[2].length + tr(' · 变更 ', ' · Changes ') + result[3].rows.length
                + tr(' · 拦截 ', ' · Interceptions ') + result[4].rows.length + tr(' · SR ', ' · SR ') + result[5].summary.length;
        }
        function formatSnapshotTime(value) {
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? String(value || '-') : date.toLocaleString(uiLanguage === 'en' ? 'en-GB' : 'zh-CN', { hour12: false });
        }
        function updateReviewUi() {
            const reviewing = Boolean(reviewInfo);
            reviewBadge.classList.toggle('active', reviewing);
            modeStatus.classList.toggle('review', reviewing);
            reviewBadge.textContent = reviewing ? tr('回顾模式', 'REVIEW MODE') + ' · ' + formatSnapshotTime(reviewInfo.capturedAt) : '';
            if (reviewing && dashboardCache) modeStatus.textContent = tr('回顾数据时间：', 'Snapshot time: ') + formatSnapshotTime(reviewInfo.capturedAt) + tr(' · 导出时间：', ' · Exported: ') + formatSnapshotTime(reviewInfo.exportedAt) + ' · ' + snapshotCounts(dashboardCache) + (simulationMode ? tr(' · 离线模拟，不访问正式接口', ' · Offline simulation; live APIs are disabled') : tr(' · 点击“刷新专题”返回实时模式', ' · Refresh to return to live mode'));
            jsonExportButton.disabled = !dashboardCache || loading;
        }
        function downloadTopicSnapshot() {
            if (!dashboardCache) return;
            const exportedAt = new Date().toISOString();
            const snapshot = {
                schema: 'uivf12-topic-snapshot', version: 1, platform: 'netcare', exportedAt,
                capturedAt: reviewInfo && reviewInfo.capturedAt || capturedAt || exportedAt,
                scope: { regionCode: CONFIG.regionCode, officeCode: CONFIG.officeCode, certificateYear: CONFIG.certificateYear, productIncorporationYear: CONFIG.productIncorporationYear },
                settings: { eos: JSON.parse(JSON.stringify(eosSettings)), changeBus: changeBuSelection, changeProductLines: changeProductLineSelection, srTypes: srTypeSelection, srProductLines: srProductLineSelection },
                data: { certificate: dashboardCache[0], eosProduct: dashboardCache[1], eosVersion: dashboardCache[2], change: dashboardCache[3], interception: dashboardCache[4], sr: dashboardCache[5] }
            };
            const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
            const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'NetCare专题全量数据_' + exportedAt.slice(0, 19).replace(/[-:T]/g, '') + '.json'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
        }
        function importTopicSnapshot(file) {
            const reader = new FileReader();
            reader.onload = async function () {
                try {
                    const snapshot = JSON.parse(String(reader.result || ''));
                    if (!snapshot || snapshot.schema !== 'uivf12-topic-snapshot' || snapshot.version !== 1 || snapshot.platform !== 'netcare') throw new Error(tr('不是有效的 NetCare 专题全量数据文件', 'Not a valid NetCare topic snapshot'));
                    const data = snapshot.data || {}; const result = [data.certificate, data.eosProduct, data.eosVersion, data.change, data.interception, data.sr];
                    if (!result.slice(0, 3).every(Array.isArray) || !data.change || !Array.isArray(data.change.rows) || !data.interception || !Array.isArray(data.interception.rows) || !data.sr || !Array.isArray(data.sr.summary) || !Array.isArray(data.sr.monthly)) throw new Error(tr('专题数据结构不完整', 'Snapshot data is incomplete'));
                    if (!reviewInfo) liveSettingsBeforeReview = { eos: JSON.parse(JSON.stringify(eosSettings)), changeBus: changeBuSelection.slice(), changeProductLines: changeProductLineSelection.slice(), srTypes: srTypeSelection.slice(), srProductLines: srProductLineSelection.slice() };
                    const importedEos = snapshot.settings && snapshot.settings.eos;
                    if (importedEos && typeof importedEos === 'object') {
                        for (const type of ['product', 'version']) {
                            if (importedEos.targets && Number.isFinite(Number(importedEos.targets[type]))) eosSettings.targets[type] = Math.min(100, Math.max(0, Number(importedEos.targets[type])));
                            if (importedEos.topN && Number.isFinite(Number(importedEos.topN[type]))) eosSettings.topN[type] = Math.min(99, Math.max(1, Math.floor(Number(importedEos.topN[type]))));
                            eosSettings.plans[type] = importedEos.plans && importedEos.plans[type] && typeof importedEos.plans[type] === 'object' ? importedEos.plans[type] : {};
                            eosSettings.notes[type] = importedEos.notes && importedEos.notes[type] && typeof importedEos.notes[type] === 'object' ? importedEos.notes[type] : {};
                        }
                        if (['quantity-desc', 'rate-asc'].includes(importedEos.sortMode)) eosSettings.sortMode = importedEos.sortMode;
                        eosSettings.collapsed = importedEos.collapsed && typeof importedEos.collapsed === 'object' ? importedEos.collapsed : {};
                    }
                    const importedSettings = snapshot.settings || {};
                    changeBuSelection = CHANGE_BU_OPTIONS.filter(value => Array.isArray(importedSettings.changeBus) && importedSettings.changeBus.includes(value));
                    changeProductLineSelection = CHANGE_PRODUCT_LINE_OPTIONS.filter(value => Array.isArray(importedSettings.changeProductLines) && importedSettings.changeProductLines.includes(value));
                    srTypeSelection = SR_TYPE_NAMES.filter(value => Array.isArray(importedSettings.srTypes) && importedSettings.srTypes.includes(value));
                    srProductLineSelection = SR_PRODUCT_LINE_OPTIONS.filter(value => Array.isArray(importedSettings.srProductLines) && importedSettings.srProductLines.includes(value));
                    dashboardCache = result; cachedInterception = data.interception; capturedAt = snapshot.capturedAt || snapshot.exportedAt; reviewInfo = { capturedAt, exportedAt: snapshot.exportedAt || capturedAt }; loaded = true;
                    renderCertificate(result[0]); renderEos(result[1], result[2]); renderChange(result[3]); renderInterception(result[4]); renderSr(result[5]); updateReviewUi();
                    if (options && typeof options.onSnapshotImported === 'function') {
                        try {
                            const saved = await options.onSnapshotImported(snapshot);
                            modeStatus.textContent += tr(' · 已归档到服务器', ' · Archived on server') + (saved && saved.created === false ? tr('（已存在）', ' (already existed)') : '');
                        } catch (saveError) {
                            modeStatus.textContent += tr(' · 服务器归档失败：', ' · Server archive failed: ') + (saveError && saveError.message || String(saveError));
                        }
                    }
                } catch (error) {
                    modeStatus.textContent = tr('导入失败：', 'Import failed: ') + (error && error.message || String(error)); modeStatus.classList.remove('review');
                } finally { jsonFileInput.value = ''; }
            };
            reader.readAsText(file, 'utf-8');
        }
        function leaveReviewMode() {
            if (!reviewInfo) return;
            if (liveSettingsBeforeReview) {
                Object.keys(eosSettings).forEach(key => { delete eosSettings[key]; }); Object.assign(eosSettings, JSON.parse(JSON.stringify(liveSettingsBeforeReview.eos)));
                changeBuSelection = liveSettingsBeforeReview.changeBus.slice(); changeProductLineSelection = liveSettingsBeforeReview.changeProductLines.slice(); srTypeSelection = liveSettingsBeforeReview.srTypes.slice(); srProductLineSelection = liveSettingsBeforeReview.srProductLines.slice();
            }
            liveSettingsBeforeReview = null; reviewInfo = null; modeStatus.classList.remove('review'); reviewBadge.classList.remove('active');
        }
        function applyLanguage() {
            button.textContent = active ? tr('返回 CSV', 'Back to CSV') : tr('NetCare 专题', 'NetCare Insights');
            button.title = tr('打开 NetCare 专题分析', 'Open NetCare insights');
            const tabLabels = { eos: tr('EOS 收编', 'EOS Incorporation'), cert: tr('证书清理', 'Certificate Cleanup'), change: tr('变更数量', 'Change Volume'), interception: tr('高危拦截', 'High-risk Interception'), sr: tr('SR 问题单', 'SR Tickets') };
            mode.querySelectorAll('.nc-tab').forEach(tab => { tab.textContent = tabLabels[tab.dataset.view]; });
            refreshButton.textContent = tr('刷新专题', 'Refresh');
            jsonExportButton.textContent = tr('导出 JSON', 'Export JSON');
            jsonImportButton.textContent = tr('导入 JSON', 'Import JSON');
            languageButton.textContent = uiLanguage === 'zh' ? 'EN' : '中';
            languageButton.title = tr('切换为英文', 'Switch to Chinese');
            if (dashboardCache) {
                renderCertificate(dashboardCache[0]); renderEos(dashboardCache[1], dashboardCache[2]); renderChange(dashboardCache[3]); renderInterception(dashboardCache[4]); renderSr(dashboardCache[5]);
                modeStatus.textContent = dashboardStatus(dashboardCache); updateReviewUi();
            } else if (!loading) {
                views.eos.innerHTML = '<div class="nc-empty">' + tr('进入专题后点击“刷新专题”获取数据', 'Click “Refresh” to load insights') + '</div>';
                modeStatus.textContent = tr('专题尚未加载', 'Insights not loaded');
            }
        }
        languageButton.addEventListener('click', function () {
            uiLanguage = uiLanguage === 'zh' ? 'en' : 'zh';
            try { localStorage.setItem(LANGUAGE_KEY, uiLanguage); } catch (error) {}
            applyLanguage();
        });
        jsonExportButton.addEventListener('click', downloadTopicSnapshot);
        jsonImportButton.addEventListener('click', function () { jsonFileInput.click(); });
        jsonFileInput.addEventListener('change', function () { if (jsonFileInput.files && jsonFileInput.files[0]) importTopicSnapshot(jsonFileInput.files[0]); });

        function escapeHtml(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        }
        function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
        function firstNumber(row, fields) {
            for (const field of fields) {
                if (row[field] !== null && row[field] !== undefined && row[field] !== '') {
                    const parsed = Number(row[field]);
                    if (Number.isFinite(parsed)) return parsed;
                }
            }
            return 0;
        }
        function normalizeCustomer(value) { const name = String(value || tr('未知', 'Unknown')).trim(); return CONFIG.customerAliases[name] || name; }
        function customerBG(value) { return CONFIG.cnbgCustomers.includes(normalizeCustomer(value)) ? 'CNBG' : 'EBG'; }
        function pad2(value) { return String(value).padStart(2, '0'); }
        function findCsrfToken() {
            // Match the working NetCare scraper: globalConfig is the current session's token source.
            const configValue = localStorage.getItem('globalConfig') || '';
            const configMatch = configValue.match(/[A-Fa-f0-9]{64}/);
            if (configMatch) return configMatch[0];
            try {
                const parsed = JSON.parse(configValue);
                const config = Array.isArray(parsed) ? parsed[0] : parsed;
                const token = config && (config.csrfToken || config.configData && config.configData.csrfToken);
                if (typeof token === 'string' && token) return token;
            } catch (error) {}
            for (const storage of [localStorage, sessionStorage]) {
                for (const key of ['csrfToken', 'csrf-token', 'x-gde-csrf-token', 'X-GDE-CSRF-TOKEN']) {
                    const value = storage.getItem(key);
                    if (value && !/[{[]/.test(value)) return value.replace(/^"|"$/g, '');
                }
                for (let index = 0; index < storage.length; index++) {
                    const value = storage.getItem(storage.key(index));
                    if (!value) continue;
                    const match = value.match(/"csrfToken"\s*:\s*"([^"]+)"/i);
                    if (match) return match[1];
                    try {
                        const stack = [JSON.parse(value)];
                        while (stack.length) {
                            const item = stack.pop();
                            if (!item || typeof item !== 'object') continue;
                            if (item.csrfToken) return item.csrfToken;
                            stack.push(...(Array.isArray(item) ? item : Object.values(item)));
                        }
                    } catch (error) {}
                }
            }
            const meta = document.querySelector('meta[name="csrf-token"],meta[name="x-gde-csrf-token"]');
            return meta && meta.content || '';
        }
        async function postJson(url, sourcePage, payload, token, simpleHeaders) {
            const headers = { accept: 'application/json, text/plain, */*', 'content-type': 'application/json;charset=UTF-8', 'x-gde-csrf-token': token };
            if (simpleHeaders) headers['x-requested-with'] = 'XMLHttpRequest';
            else { headers['x-gde-src-page'] = sourcePage; headers['x-gde-target-app'] = 'NetCareOperationCenter'; }
            const response = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) });
            const json = await response.json().catch(() => null);
            if (!response.ok) {
                const csrfFailed = json && String(json.code) === '03200003';
                throw new Error(csrfFailed
                    ? tr('CSRF token 校验失败，请刷新 NetCare 页面后重试。', 'CSRF token validation failed. Refresh NetCare and try again.')
                    : 'HTTP ' + response.status + ' ' + response.statusText + (json && json.message ? '：' + json.message : ''));
            }
            if (!json) throw new Error(tr('NetCare 返回的数据不是 JSON。', 'NetCare returned a non-JSON response.'));
            if (json.code && String(json.code) !== '0' && String(json.code) !== '200') throw new Error(json.message || tr('接口错误：', 'API error: ') + json.code);
            return json;
        }
        async function loadAllPages(name, url, sourcePage, payload, token) {
            const limit = num(payload.limit) || CONFIG.pageSize;
            const first = await postJson(url, sourcePage, Object.assign({}, payload, { start: 0, limit }), token, false);
            const rows = [...(first.results || [])];
            const total = num(first.total);
            for (let start = limit; start < total; start += limit) {
                modeStatus.textContent = name + tr('：正在加载 ', ': loading ') + Math.min(rows.length, total) + '/' + total;
                const page = await postJson(url, sourcePage, Object.assign({}, payload, { start, limit }), token, false);
                rows.push(...(page.results || []));
            }
            return rows;
        }
        function monthRange(year, month) {
            const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
            return { start: year + '-' + pad2(month) + '-01', end: year + '-' + pad2(month) + '-' + pad2(last) };
        }
        async function postChangeSummary(year, month, scope, token, selectedBus, selectedProductLines) {
            const range = monthRange(year, month);
            const raw = await postJson(API_URLS.change, '', {
                bg: scope === 'TOTAL' ? [] : [scope], region: '', rep_office: '', product_line: selectedProductLines, network_id: [], bu: selectedBus, t1_operator: [],
                na_type: [], network_level: '', operate_level: [], wo_type: [], region_code: [CONFIG.regionCode], office_code: [CONFIG.officeCode],
                start_date: range.start, end_date: range.end, country_code: [], key_ne: []
            }, token, true);
            const data = raw.data || raw.result || raw;
            return { year, month, scope, task_count: num(data.task_count), rollback_count: num(data.rollback_count), operation_success_rate: num(data.operation_success_rate), high_core_total_count: num(data.high_core_total_count) };
        }
        async function runConcurrent(items, limit, worker) {
            const output = new Array(items.length); let next = 0;
            async function runner() { while (true) { const index = next++; if (index >= items.length) return; output[index] = await worker(items[index], index); } }
            await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
            return output;
        }
        async function loadChangeData(token, requestedBus, requestedProductLines) {
            const now = new Date(); const currentYear = now.getFullYear(); const previousYear = currentYear - 1; const jobs = [];
            const selectedBus = CHANGE_BU_OPTIONS.filter(value => Array.isArray(requestedBus) && requestedBus.includes(value));
            const selectedProductLines = CHANGE_PRODUCT_LINE_OPTIONS.filter(value => Array.isArray(requestedProductLines) && requestedProductLines.includes(value));
            for (const year of [previousYear, currentYear]) for (let month = 1; month <= 12; month++) for (const scope of ['TOTAL', 'CNBG', 'EBG']) jobs.push({ year, month, scope });
            let completed = 0;
            const rows = await runConcurrent(jobs, 6, async job => { const row = await postChangeSummary(job.year, job.month, job.scope, token, selectedBus, selectedProductLines); modeStatus.textContent = tr('变更数量：', 'Change volume: ') + (++completed) + '/' + jobs.length; return row; });
            return { rows, currentYear, previousYear, currentMonth: now.getMonth() + 1, bus: selectedBus, productLines: selectedProductLines };
        }
        function normalizeSrRow(data, meta) {
            const stat = data.statResults || {};
            return Object.assign({}, meta, {
                sr_total: num(data.sr_total), sr_frt: num(data.sr_frt), unclose_sr_cnt: num(data.unclose_sr_cnt),
                due_within_5days_sr_cnt: num(data.due_within_5days_sr_cnt), overdue_unclose_sr_cnt: num(data.overdue_unclose_sr_cnt),
                over_10days_sr_cnt: num(data.over_10days_sr_cnt), overdue_sr_cnt: num(data.overdue_sr_cnt),
                emergency_recovery_cnt: num(data.emergency_recovery_cnt), unrecovered_emergency_cnt: num(data.unrecovered_emergency_cnt),
                overlong_sr_cnt: num(data.overlong_sr_cnt), non_fault_inquiry_sr_cnt: num(data.non_fault_inquiry_sr_cnt),
                minor_sr_cnt: num(data.minor_sr_cnt), major_sr_cnt: num(data.major_sr_cnt), critical_sr_cnt: num(data.critical_sr_cnt),
                low_score_cnt: num(data.low_score_cnt), authed_rate: num(data.authed_rate), auth_out_warranty_rate: num(data.auth_out_warranty_rate),
                e2e_report_to_resolve_dura: num(data.e2e_report_to_resolve_dura), vip_tac_rate: data.vip_tac_rate,
                stat: { authed_cnt: num(stat.authed_cnt), sn_auth_cnt: num(stat.sn_auth_cnt), auth_out_warranty_cnt: num(stat.auth_out_warranty_cnt), sr_frt_c: num(stat.sr_frt_c), sr_frt_d: num(stat.sr_frt_d), report_to_resolve_dura: num(stat.report_to_resolve_dura), e2e_sr_total: num(stat.e2e_sr_total) }
            });
        }
        async function postSrSummary(startDate, endDate, scope, token, meta, selectedSrTypes, selectedProductLines) {
            const raw = await postJson(API_URLS.sr, '', {
                product_line: selectedProductLines, network_id: [], region_code: [CONFIG.regionCode], office_code: [CONFIG.officeCode], t1_operator: [], na_type: [],
                sr_type_name: selectedSrTypes.length ? selectedSrTypes : SR_TYPE_NAMES, level: [], start_date: startDate, end_date: endDate, bg: scope === 'TOTAL' ? ['CNBG', 'EBG'] : [scope],
                resolution_name: [], country_code: [], sr_tac: [], tac_2bg: [], market_type: [], sr_status_name: [], bu_name: [],
                esc_to_pse_flag: [], esc_to_pse_org: [], esc_to_rde_flag: [], customer_name: [], product_class: [], product: [], sr_num: []
            }, token, true);
            return normalizeSrRow(raw.data || raw.result || raw, Object.assign({ scope }, meta));
        }
        async function loadSrData(token, requestedTypes, requestedProductLines) {
            const now = new Date(); const currentYear = now.getFullYear(); const previousYear = currentYear - 1; const currentMonth = now.getMonth() + 1;
            const selectedSrTypes = SR_TYPE_NAMES.filter(value => Array.isArray(requestedTypes) && requestedTypes.includes(value));
            const selectedProductLines = SR_PRODUCT_LINE_OPTIONS.filter(value => Array.isArray(requestedProductLines) && requestedProductLines.includes(value));
            const currentEnd = monthRange(currentYear, currentMonth).end; const previousYtdEnd = monthRange(previousYear, currentMonth).end; const jobs = [];
            for (const scope of ['TOTAL', 'CNBG', 'EBG']) {
                jobs.push({ kind: 'summary', period: 'previousFull', scope, start: previousYear + '-01-01', end: previousYear + '-12-31' });
                jobs.push({ kind: 'summary', period: 'previousYtd', scope, start: previousYear + '-01-01', end: previousYtdEnd });
                jobs.push({ kind: 'summary', period: 'currentYtd', scope, start: currentYear + '-01-01', end: currentEnd });
            }
            for (const year of [previousYear, currentYear]) {
                const maxMonth = year === currentYear ? currentMonth : 12;
                for (let month = 1; month <= maxMonth; month += 1) {
                    const range = monthRange(year, month);
                    for (const scope of ['TOTAL', 'CNBG', 'EBG']) {
                        jobs.push({ kind: 'month', year, month, scope, start: range.start, end: range.end });
                    }
                }
            }
            let completed = 0;
            const rows = await runConcurrent(jobs, 6, async job => {
                const row = await postSrSummary(job.start, job.end, job.scope, token, job.kind === 'summary' ? { period: job.period, scope: job.scope } : { year: job.year, month: job.month, scope: job.scope }, selectedSrTypes, selectedProductLines);
                modeStatus.textContent = tr('SR 问题单：', 'SR tickets: ') + (++completed) + '/' + jobs.length; return row;
            });
            return { summary: rows.filter(row => row.period), monthly: rows.filter(row => row.year), currentYear, previousYear, currentMonth, srTypes: selectedSrTypes, productLines: selectedProductLines };
        }
        function aggregateSrRows(rows) {
            const result = normalizeSrRow({}, {}); const countFields = ['sr_total', 'due_within_5days_sr_cnt', 'overdue_unclose_sr_cnt', 'over_10days_sr_cnt', 'overdue_sr_cnt', 'emergency_recovery_cnt', 'unrecovered_emergency_cnt', 'overlong_sr_cnt', 'non_fault_inquiry_sr_cnt', 'minor_sr_cnt', 'major_sr_cnt', 'critical_sr_cnt', 'low_score_cnt'];
            rows.forEach(row => { countFields.forEach(field => { result[field] += num(row[field]); }); Object.keys(result.stat).forEach(field => { result.stat[field] += num(row.stat && row.stat[field]); }); });
            result.sr_frt = result.stat.sr_frt_d ? result.stat.sr_frt_c / result.stat.sr_frt_d : 0;
            result.authed_rate = result.stat.sn_auth_cnt ? result.stat.authed_cnt / result.stat.sn_auth_cnt : 0;
            result.auth_out_warranty_rate = result.stat.authed_cnt ? result.stat.auth_out_warranty_cnt / result.stat.authed_cnt : 0;
            result.e2e_report_to_resolve_dura = result.stat.e2e_sr_total ? result.stat.report_to_resolve_dura / result.stat.e2e_sr_total : 0;
            return result;
        }
        async function postInterception(year, scope, token) {
            const raw = await postJson(API_URLS.highRiskInterception, '', {
                bg: scope === 'TOTAL' ? [] : [scope], region_code: [CONFIG.regionCode], office_code: [CONFIG.officeCode], product_line: [],
                start_date: year + '-01-01', end_date: year + '-12-31', source_map: [], account: '', regionTotal: 1, group_by: 'period_month', kpi_type: 'interception'
            }, token, true);
            return (raw.results || raw.data && raw.data.results || []).map(row => ({
                year, scope, month: num(String(row.period_month || row.name || '').split('-')[1]),
                interception_cnt: num(row.interception_cnt), commands_interception_cnt: num(row.commands_interception_cnt), graphical_interception_cnt: num(row.graphical_interception_cnt)
            })).filter(row => row.month >= 1 && row.month <= 12);
        }
        async function loadInterceptionData(token) {
            const now = new Date(); const currentYear = now.getFullYear(); const previousYear = currentYear - 1; const jobs = [];
            for (const year of [previousYear, currentYear]) for (const scope of ['TOTAL', 'CNBG', 'EBG']) jobs.push({ year, scope });
            const groups = await Promise.all(jobs.map(job => postInterception(job.year, job.scope, token)));
            return { rows: groups.flat(), currentYear, previousYear, currentMonth: now.getMonth() + 1 };
        }
        function formatChange(current, base) {
            const delta = current - base; const sign = delta > 0 ? '+' : '';
            const rate = base ? ' (' + sign + ((delta / base) * 100).toFixed(1) + '%)' : (current ? tr(' (新增)', ' (new)') : ' (0%)');
            return sign + delta.toLocaleString('zh-CN') + rate;
        }
        function emptyEosMetric() { return { quantity: 0, incorporated: 0, pending: 0, noPlan: 0, annualPlan: 0, noPlanItems: {}, noPlanItemsByCustomer: {} }; }
        function createEosBucket() { return { product: emptyEosMetric(), version: emptyEosMetric() }; }
        function eosIncorporated(row, type, quantity) {
            const normal = type === 'product' ? firstNumber(row, ['before_urgent_incorporated_nes_dtl', 'incorporated_nes']) : firstNumber(row, ['nc_urgent_incorp_complet_rate_dtl', 'incorporated_nes']);
            const total = normal + firstNumber(row, ['deactivated_nes']);
            return quantity > 0 ? Math.min(quantity, total) : total;
        }
        function addEosMetric(target, source) {
            target.quantity += num(source.quantity); target.incorporated += num(source.incorporated); target.pending += num(source.pending);
            target.noPlan += num(source.noPlan); target.annualPlan += num(source.annualPlan);
            if (source.noPlan > 0 && source.pendingLabel) {
                target.noPlanItems[source.pendingLabel] = num(target.noPlanItems[source.pendingLabel]) + source.noPlan;
                const customer = source.customer || tr('未分类客户', 'Uncategorized customer');
                if (!target.noPlanItemsByCustomer[customer]) target.noPlanItemsByCustomer[customer] = {};
                target.noPlanItemsByCustomer[customer][source.pendingLabel] = num(target.noPlanItemsByCustomer[customer][source.pendingLabel]) + source.noPlan;
            }
        }
        function eosItemLabel(row, type) {
            if (type === 'product') return String(row.product_name || row.product_code_name || row.product_code || tr('未命名产品', 'Unnamed product'));
            return String(row.software_version || row.version_name || row.product_name || tr('未命名版本', 'Unnamed version'));
        }
        function eosItemKey(row, type) {
            return [normalizeCustomer(row.customer_name), row.product_line_name || row.product_line_map || '', row.product_name || '', eosItemLabel(row, type)].join('|||');
        }
        function buildEosItems(rows, type) {
            const grouped = new Map();
            rows.forEach(row => {
                const key = eosItemKey(row, type);
                if (!grouped.has(key)) grouped.set(key, {
                    key, type, bg: customerBG(row.customer_name), customer: normalizeCustomer(row.customer_name),
                    productLine: String(row.product_line_name || row.product_line_map || ''), product: String(row.product_name || tr('未命名产品', 'Unnamed product')), label: eosItemLabel(row, type),
                    quantity: 0, incorporated: 0, pending: 0, noPlan: 0, annualPlan: 0
                });
                const item = grouped.get(key); const quantity = firstNumber(row, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']);
                item.quantity += quantity; item.incorporated += eosIncorporated(row, type, quantity); item.pending += firstNumber(row, ['to_be_incorporated_nes']);
            });
            return [...grouped.values()].map(item => {
                const saved = Math.max(0, Math.floor(num(eosSettings.plans[type][item.key])));
                item.annualPlan = Math.min(item.pending, saved);
                item.noPlan = Math.max(0, item.pending - item.annualPlan);
                item.progressNote = String(eosSettings.notes && eosSettings.notes[type] && eosSettings.notes[type][item.key] || '').slice(0, 500);
                const lineLabel = item.productLine || tr('未分类产品线', 'Uncategorized line');
                item.pendingLabel = type === 'product' ? lineLabel + ' · ' + item.label : lineLabel + ' · ' + item.product + ' / ' + item.label;
                if (saved !== item.annualPlan) eosSettings.plans[type][item.key] = item.annualPlan;
                return item;
            });
        }
        function buildEos(productItems, versionItems) {
            const data = { CNBG: createEosBucket(), EBG: createEosBucket(), TOTAL: createEosBucket(), customers: {} };
            function consume(items, type) { items.forEach(item => { if (!data.customers[item.customer]) data.customers[item.customer] = createEosBucket(); addEosMetric(data.TOTAL[type], item); addEosMetric(data[item.bg][type], item); addEosMetric(data.customers[item.customer][type], item); }); }
            consume(productItems, 'product'); consume(versionItems, 'version'); return data;
        }
        function eosRate(metric, includePlan) { return metric.quantity ? Math.min(metric.quantity, metric.incorporated + (includePlan ? metric.annualPlan : 0)) / metric.quantity * 100 : 0; }
        function eosSuggestedRate(metric, continuedNoPlan) { return metric.quantity ? Math.min(metric.quantity, metric.incorporated + metric.annualPlan + num(continuedNoPlan)) / metric.quantity * 100 : 0; }
        function rateCell(metric, target, includePlan) {
            const value = eosRate(metric, includePlan); const hasValue = metric.quantity > 0;
            return '<td class="' + (hasValue ? (value >= target ? 'nc-good' : 'nc-bad') : 'nc-muted') + '">' + (hasValue ? value.toFixed(1) + '%' : '-') + '</td>';
        }
        function topNoPlanGroups(metric, type) {
            const topN = eosSettings.topN[type];
            return Object.entries(metric.noPlanItemsByCustomer || {}).map(entry => {
                const items = Object.entries(entry[1] || {}).filter(item => item[1] > 0).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'));
                const topItems = items.slice(0, topN);
                return { customer: entry[0], noPlan: items.reduce((total, item) => total + item[1], 0), continueCount: topItems.reduce((total, item) => total + item[1], 0), items: topItems };
            }).filter(group => group.noPlan > 0).sort((left, right) => right.noPlan - left.noPlan || left.customer.localeCompare(right.customer, 'zh-CN'));
        }
        function topNoPlanCell(metric, type) {
            const groups = topNoPlanGroups(metric, type);
            if (!groups.length || !metric.noPlan) return '<td class="nc-top-empty">-</td>';
            return '<td><div class="nc-top-list">' + groups.map(group => '<div class="nc-top-customer"><strong class="nc-top-customer-title">' + escapeHtml(group.customer) + ' · ' + tr('无计划中继续收编 ', 'Continue from No Plan ') + group.continueCount + '</strong>' + group.items.map((entry, index) => '<span><b>' + (index + 1) + '.</b> ' + escapeHtml(entry[0]) + ' · ' + entry[1] + (uiLanguage === 'en' ? ' (' : '（') + (entry[1] / group.noPlan * 100).toFixed(1) + '%' + (uiLanguage === 'en' ? ')' : '）') + '</span>').join('') + '</div>').join('') + '</div></td>';
        }
        function briefGap(rate, target) {
            const difference = rate - target;
            if (Math.abs(difference) < 0.05) return '<span class="nc-brief-good">' + tr('达到目标', 'meets the target') + '</span>';
            if (difference > 0) return tr('高于目标 ', 'above target by ') + '<span class="nc-brief-good">' + difference.toFixed(1) + tr(' 个百分点', ' pp') + '</span>';
            return tr('距离目标 ', 'gap to target ') + '<span class="nc-brief-gap">' + Math.abs(difference).toFixed(1) + tr(' 个百分点', ' pp') + '</span>';
        }
        function renderEosBrief(items, metric, type) {
            const isProduct = type === 'product'; const target = eosSettings.targets[type]; const topN = eosSettings.topN[type]; const currentRate = eosRate(metric, false); const projectedRate = eosRate(metric, true);
            const noPlanGroups = topNoPlanGroups(metric, type); const continuedNoPlan = noPlanGroups.reduce((total, group) => total + group.continueCount, 0);
            const topRate = eosSuggestedRate(metric, continuedNoPlan);
            const openParen = uiLanguage === 'en' ? ' (' : '（'; const closeParen = uiLanguage === 'en' ? ')' : '）';
            const focusCustomers = noPlanGroups.slice(0, 3).map(group => '<span class="nc-brief-focus">' + escapeHtml(group.customer) + openParen + group.noPlan + closeParen + '</span>').join(tr('、', ', ')) || tr('暂无', 'None');
            const requirements = noPlanGroups.flatMap(group => group.items.map(entry => '<span class="nc-brief-focus">' + escapeHtml(group.customer) + '—' + escapeHtml(entry[0]) + openParen + entry[1] + closeParen + '</span>')).join(tr('；', '; ')) || tr('暂无无计划重点项', 'No priority No Plan items');
            const title = tr(isProduct ? '产品收编建议' : '版本收编建议', isProduct ? 'Product Incorporation Brief' : 'Version Incorporation Brief');
            const progress = uiLanguage === 'en'
                ? 'Overall progress is <strong>' + metric.incorporated + ' / ' + metric.quantity + ' (' + currentRate.toFixed(1) + '%)</strong>, with plan <strong>' + metric.annualPlan + '</strong> and No Plan <strong>' + metric.noPlan + '</strong>. Priority No Plan customers: ' + focusCustomers + '.'
                : '整体已收编 <strong>' + metric.incorporated + ' / ' + metric.quantity + '（' + currentRate.toFixed(1) + '%）</strong>，今年计划 <strong>' + metric.annualPlan + '</strong>，无计划 <strong>' + metric.noPlan + '</strong>；重点跟进无计划客户：' + focusCustomers + '。';
            const action = uiLanguage === 'en'
                ? 'Each customer’s No Plan Top ' + topN + ': ' + requirements + '. Based on <strong>' + metric.incorporated + '</strong> incorporated and completing the entered plan of <strong>' + metric.annualPlan + '</strong>, continuing with <strong>' + continuedNoPlan + '</strong> from No Plan would lift the rate from the plan-only <strong>' + projectedRate.toFixed(1) + '%</strong> to <strong>' + topRate.toFixed(1) + '%</strong> versus the <strong>' + target + '%</strong> target (' + briefGap(topRate, target) + ').'
                : '各客户无计划 Top ' + topN + ' 推进要求：' + requirements + '；在已收编 <strong>' + metric.incorporated + '</strong>、完成已录入今年计划 <strong>' + metric.annualPlan + '</strong> 的基础上，再从无计划中继续收编 <strong>' + continuedNoPlan + '</strong>，预计收编率由仅完成计划时的 <strong>' + projectedRate.toFixed(1) + '%</strong> 提升至 <strong>' + topRate.toFixed(1) + '%</strong>，目标 <strong>' + target + '%</strong>（' + briefGap(topRate, target) + '）。';
            return '<section class="nc-eos-brief ' + (isProduct ? 'product' : 'version') + '"><div class="nc-eos-brief-title">' + title + '</div><p>' + progress + '</p><p>' + action + '</p></section>';
        }
        function eosRow(name, bucket, kind) {
            const productTop = kind === 'child' ? topNoPlanCell(bucket.product, 'product') : '<td class="nc-top-empty">—</td>';
            const versionTop = kind === 'child' ? topNoPlanCell(bucket.version, 'version') : '<td class="nc-top-empty">—</td>';
            return '<tr class="' + (kind === 'total' ? 'nc-total' : kind === 'bg' ? 'nc-bg' : '') + '"><td class="nc-name ' + (kind === 'child' ? 'nc-child' : '') + '">' + (kind === 'child' ? '└ ' : '') + escapeHtml(name) + '</td><td>' + bucket.product.quantity + '</td>' + rateCell(bucket.product, eosSettings.targets.product, false) + '<td>' + bucket.product.pending + '</td><td>' + bucket.product.annualPlan + '</td><td>' + bucket.product.noPlan + '</td>' + rateCell(bucket.product, eosSettings.targets.product, true) + productTop + '<td>' + bucket.version.quantity + '</td>' + rateCell(bucket.version, eosSettings.targets.version, false) + '<td>' + bucket.version.pending + '</td><td>' + bucket.version.annualPlan + '</td><td>' + bucket.version.noPlan + '</td>' + rateCell(bucket.version, eosSettings.targets.version, true) + versionTop + '</tr>';
        }
        function sortEosItems(items) {
            return items.sort((left, right) => {
                const pendingDifference = right.pending - left.pending;
                if (pendingDifference) return pendingDifference;
                if (eosSettings.sortMode === 'rate-asc') return eosRate(left, false) - eosRate(right, false) || right.quantity - left.quantity || left.label.localeCompare(right.label, 'zh-CN');
                return right.quantity - left.quantity || eosRate(left, false) - eosRate(right, false) || left.label.localeCompare(right.label, 'zh-CN');
            });
        }
        function eosPendingTotal(items) { return items.reduce((total, item) => total + item.pending, 0); }
        function groupEosItems(items, field) {
            const groups = new Map();
            items.forEach(item => { const key = item[field] || tr('未分类', 'Uncategorized'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
            return [...groups.entries()].sort((left, right) => eosPendingTotal(right[1]) - eosPendingTotal(left[1]) || left[0].localeCompare(right[0], 'zh-CN'));
        }
        function eosCollapseKey(type, bg, customer, productLine) { return JSON.stringify([type, bg, customer, productLine === undefined ? 'customer' : 'line', productLine || '']); }
        function eosCollapseButton(key, collapsed) {
            return '<button class="nc-collapse-button" type="button" data-collapse-key="' + escapeHtml(key) + '" title="' + tr(collapsed ? '展开分组' : '折叠分组', collapsed ? 'Expand group' : 'Collapse group') + '">' + (collapsed ? '▸' : '▾') + '</button>';
        }
        function eosStickyAttrs(level, label) { return ' data-sticky-level="' + level + '" data-sticky-label="' + escapeHtml(label) + '"'; }
        function aggregateEosItems(items) { const metric = emptyEosMetric(); items.forEach(item => addEosMetric(metric, item)); return metric; }
        function mergedEosRow(items, type, level, label, key) {
            const isProduct = type === 'product'; const metric = aggregateEosItems(items); const countHint = tr('合并 ', 'Merged ') + items.length + tr(' 项', ' items');
            const descriptors = level === 'customer'
                ? '<td></td><td class="nc-merged-label">' + eosCollapseButton(key, true) + escapeHtml(label) + '</td><td class="nc-merged-hint">' + countHint + '</td><td>—</td>' + (isProduct ? '' : '<td>—</td>')
                : '<td></td><td></td><td class="nc-merged-label">' + eosCollapseButton(key, true) + escapeHtml(label) + '</td><td class="nc-merged-hint">' + countHint + '</td>' + (isProduct ? '' : '<td>—</td>');
            return '<tr class="nc-merged-row ' + level + '"' + eosStickyAttrs(level, label + ' · ' + countHint) + '>' + descriptors + '<td>' + metric.quantity + '</td><td>' + metric.incorporated + '</td>' + rateCell(metric, eosSettings.targets[type], false) + '<td>' + metric.pending + '</td><td class="nc-readonly-plan" title="' + tr('合并行只读', 'Merged row is read-only') + '">' + metric.annualPlan + '</td><td>' + metric.noPlan + '</td>' + rateCell(metric, eosSettings.targets[type], true) + '<td class="nc-muted">—</td></tr>';
        }
        function renderEosItemTable(items, type) {
            const isProduct = type === 'product'; const target = eosSettings.targets[type]; const rows = []; const visibleItems = items; const columnCount = isProduct ? 12 : 13;
            for (const bg of ['CNBG', 'EBG']) {
                const bgItems = visibleItems.filter(item => item.bg === bg);
                if (!bgItems.length) continue;
                const bgLabel = bg + ' · ' + bgItems.length + tr(' 项', ' items');
                rows.push('<tr class="nc-bg-divider"' + eosStickyAttrs('bg', bgLabel) + '><td colspan="' + columnCount + '">' + bgLabel + '</td></tr>');
                groupEosItems(bgItems, 'customer').forEach(customerGroup => {
                    const customerKey = eosCollapseKey(type, bg, customerGroup[0]); const customerCollapsed = eosSettings.collapsed[customerKey] !== false;
                    if (customerCollapsed) { rows.push(mergedEosRow(customerGroup[1], type, 'customer', customerGroup[0], customerKey)); return; }
                    const customerLabel = tr('客户：', 'Customer: ') + customerGroup[0] + ' · ' + tr('待收编 ', 'Pending ') + eosPendingTotal(customerGroup[1]);
                    rows.push('<tr class="nc-customer-divider"' + eosStickyAttrs('customer', customerLabel) + '><td colspan="' + columnCount + '">' + eosCollapseButton(customerKey, false) + escapeHtml(customerLabel) + '</td></tr>');
                    groupEosItems(customerGroup[1], 'productLine').forEach(lineGroup => {
                        const lineKey = eosCollapseKey(type, bg, customerGroup[0], lineGroup[0]); const lineCollapsed = eosSettings.collapsed[lineKey] !== false;
                        if (lineCollapsed) { rows.push(mergedEosRow(lineGroup[1], type, 'line', lineGroup[0], lineKey)); return; }
                        const lineLabel = tr('产品线：', 'Product line: ') + lineGroup[0] + ' · ' + tr('待收编 ', 'Pending ') + eosPendingTotal(lineGroup[1]);
                        rows.push('<tr class="nc-line-divider"' + eosStickyAttrs('line', lineLabel) + '><td colspan="' + columnCount + '">' + eosCollapseButton(lineKey, false) + escapeHtml(lineLabel) + '</td></tr>');
                        const appendItem = item => {
                            const globalIndex = items.indexOf(item); const dataAttrs = ' data-eos-type="' + type + '" data-eos-index="' + globalIndex + '"';
                            const noteDataAttrs = ' data-note-type="' + type + '" data-note-index="' + globalIndex + '"';
                            const input = '<div class="nc-plan-control"><button class="nc-plan-step" type="button" data-plan-action="minus"' + dataAttrs + ' title="' + tr('减少 1', 'Decrease by 1') + '">−</button><input class="nc-plan-input" type="number" min="0" max="' + item.pending + '" step="1" value="' + item.annualPlan + '"' + dataAttrs + ' title="' + tr('不得大于待收编数量 ', 'Cannot exceed pending count ') + item.pending + '"><button class="nc-plan-step" type="button" data-plan-action="plus"' + dataAttrs + ' title="' + tr('增加 1', 'Increase by 1') + '">+</button><button class="nc-plan-preset" type="button" data-plan-action="half"' + dataAttrs + '>' + tr('半数', 'Half') + '</button><button class="nc-plan-preset" type="button" data-plan-action="all"' + dataAttrs + '>' + tr('全部', 'All') + '</button><button class="nc-plan-preset" type="button" data-plan-action="clear"' + dataAttrs + '>' + tr('清空', 'Clear') + '</button></div>';
                            const note = '<textarea class="nc-progress-note" maxlength="500" placeholder="' + tr('填写进展备注', 'Add progress note') + '"' + noteDataAttrs + '>' + escapeHtml(item.progressNote) + '</textarea>';
                            if (isProduct) rows.push('<tr><td></td><td></td><td></td><td class="nc-item-label">' + escapeHtml(item.label) + '</td><td>' + item.quantity + '</td><td>' + item.incorporated + '</td>' + rateCell(item, target, false) + '<td>' + item.pending + '</td><td>' + input + '</td><td>' + item.noPlan + '</td>' + rateCell(item, target, true) + '<td>' + note + '</td></tr>');
                            else rows.push('<tr><td></td><td></td><td></td><td></td><td class="nc-version-label">' + escapeHtml(item.label) + '</td><td>' + item.quantity + '</td><td>' + item.incorporated + '</td>' + rateCell(item, target, false) + '<td>' + item.pending + '</td><td>' + input + '</td><td>' + item.noPlan + '</td>' + rateCell(item, target, true) + '<td>' + note + '</td></tr>');
                        };
                        if (isProduct) sortEosItems(lineGroup[1]).forEach(appendItem);
                        else groupEosItems(lineGroup[1], 'product').forEach(productGroup => {
                            const productLabel = tr('产品：', 'Product: ') + productGroup[0] + ' · ' + tr('待收编 ', 'Pending ') + eosPendingTotal(productGroup[1]);
                            rows.push('<tr class="nc-product-divider"' + eosStickyAttrs('product', productLabel) + '><td colspan="' + columnCount + '">' + escapeHtml(productLabel) + '</td></tr>');
                            sortEosItems(productGroup[1]).forEach(appendItem);
                        });
                    });
                });
            }
            const bulkActions = '<div class="nc-bulk-actions"><button class="nc-bulk-button" type="button" data-collapse-action="expand" data-collapse-type="' + type + '">' + tr('全部展开', 'Expand All') + '</button><button class="nc-bulk-button nc-table-fullscreen-button" type="button" data-table-fullscreen="' + type + '">' + tr('全屏', 'Fullscreen') + '</button><button class="nc-bulk-button" type="button" data-collapse-action="collapse" data-collapse-type="' + type + '">' + tr('全部折叠', 'Collapse All') + '</button><button class="nc-bulk-button" type="button" data-bulk-action="all" data-bulk-type="' + type + '">' + tr('全部填满', 'Fill All') + '</button><button class="nc-bulk-button" type="button" data-bulk-action="topn" data-bulk-type="' + type + '">' + tr('填各客户 Top ', 'Fill Each Customer Top ') + eosSettings.topN[type] + '</button><button class="nc-bulk-button" type="button" data-bulk-action="clear" data-bulk-type="' + type + '">' + tr('清空全部', 'Clear All') + '</button></div>';
            return '<div class="nc-card nc-eos-card" data-eos-card-type="' + type + '"><div class="nc-card-title"><div class="nc-card-title-main"><span>' + tr('EOS ' + (isProduct ? '产品' : '版本') + '表', 'EOS ' + (isProduct ? 'Product' : 'Version') + ' Table') + '</span><small>' + tr('显示全部数据 · ', 'All records · ') + visibleItems.length + tr(' 项 · 目标 ', ' items · Target ') + target + '%</small></div>' + bulkActions + '</div><div class="nc-table-wrap nc-eos-table-wrap" data-eos-table-type="' + type + '"><div class="nc-eos-sticky-context" aria-hidden="true"></div><table class="nc-table nc-eos-detail-table"><thead><tr><th>BG</th><th>' + tr('客户', 'Customer') + '</th><th>' + tr('产品线', 'Product Line') + '</th>' + (isProduct ? '<th>' + tr('产品', 'Product') + '</th>' : '<th>' + tr('产品', 'Product') + '</th><th>' + tr('版本', 'Version') + '</th>') + '<th>' + tr('数量', 'Quantity') + '</th><th>' + tr('已收编', 'Incorporated') + '</th><th>' + tr('收编率', 'Rate') + '</th><th>' + tr('待收编', 'Pending') + '</th><th>' + tr('今年计划完成数量', 'Planned This Year') + '</th><th>' + tr('无计划', 'No Plan') + '</th><th>' + tr('今年预计达成收编率', 'Projected Rate This Year') + '</th><th>' + tr('进展备注', 'Progress Note') + '</th></tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="' + columnCount + '" class="nc-muted">' + tr('暂无 EOS 数据', 'No EOS data') + '</td></tr>') + '</tbody></table></div></div>';
        }
        function xlsxXml(value) { return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }
        function xlsxColumn(index) { let name = ''; for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name; return name; }
        function xlsxCell(cell, rowIndex, columnIndex) {
            const spec = cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'v') ? cell : { v: cell };
            const style = spec.s ? ' s="' + spec.s + '"' : ''; const ref = xlsxColumn(columnIndex) + rowIndex;
            if (typeof spec.v === 'number' && Number.isFinite(spec.v)) return '<c r="' + ref + '"' + style + '><v>' + spec.v + '</v></c>';
            return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xlsxXml(spec.v) + '</t></is></c>';
        }
        function buildXlsxSheet(rows, options) {
            const columnCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 1); const rowCount = Math.max(rows.length, 1);
            const columns = (options.widths || []).map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join('');
            const sheetRows = rows.map((row, index) => '<row r="' + (index + 1) + '"' + (row.height ? ' ht="' + row.height + '" customHeight="1"' : '') + '>' + row.cells.map((cell, columnIndex) => xlsxCell(cell, index + 1, columnIndex)).join('') + '</row>').join('');
            const merges = (options.merges || []).length ? '<mergeCells count="' + options.merges.length + '">' + options.merges.map(ref => '<mergeCell ref="' + ref + '"/>').join('') + '</mergeCells>' : '';
            const pane = options.freezeRows ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + options.freezeRows + '" topLeftCell="A' + (options.freezeRows + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
            const filter = options.autoFilter ? '<autoFilter ref="' + options.autoFilter + '"/>' : '';
            return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:' + xlsxColumn(columnCount - 1) + rowCount + '"/>' + pane + '<sheetFormatPr defaultRowHeight="16"/>' + (columns ? '<cols>' + columns + '</cols>' : '') + '<sheetData>' + sheetRows + '</sheetData>' + filter + merges + '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>';
        }
        function xlsxCrc32(bytes) {
            let crc = 0xffffffff;
            for (let index = 0; index < bytes.length; index += 1) { crc ^= bytes[index]; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
            return (crc ^ 0xffffffff) >>> 0;
        }
        function xlsxU16(value) { return new Uint8Array([value & 255, value >>> 8 & 255]); }
        function xlsxU32(value) { return new Uint8Array([value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255]); }
        function xlsxJoin(parts) { const size = parts.reduce((total, part) => total + part.length, 0); const output = new Uint8Array(size); let offset = 0; parts.forEach(part => { output.set(part, offset); offset += part.length; }); return output; }
        function createXlsxZip(files) {
            const encoder = new TextEncoder(); const localParts = []; const centralParts = []; let offset = 0;
            Object.entries(files).forEach(entry => {
                const name = encoder.encode(entry[0]); const data = encoder.encode(entry[1]); const crc = xlsxCrc32(data); const flags = 0x0800;
                const local = xlsxJoin([xlsxU32(0x04034b50), xlsxU16(20), xlsxU16(flags), xlsxU16(0), xlsxU16(0), xlsxU16(0), xlsxU32(crc), xlsxU32(data.length), xlsxU32(data.length), xlsxU16(name.length), xlsxU16(0), name, data]);
                const central = xlsxJoin([xlsxU32(0x02014b50), xlsxU16(20), xlsxU16(20), xlsxU16(flags), xlsxU16(0), xlsxU16(0), xlsxU16(0), xlsxU32(crc), xlsxU32(data.length), xlsxU32(data.length), xlsxU16(name.length), xlsxU16(0), xlsxU16(0), xlsxU16(0), xlsxU16(0), xlsxU32(0), xlsxU32(offset), name]);
                localParts.push(local); centralParts.push(central); offset += local.length;
            });
            const central = xlsxJoin(centralParts); const end = xlsxJoin([xlsxU32(0x06054b50), xlsxU16(0), xlsxU16(0), xlsxU16(centralParts.length), xlsxU16(centralParts.length), xlsxU32(central.length), xlsxU32(offset), xlsxU16(0)]);
            return xlsxJoin(localParts.concat([central, end]));
        }
        function orderedEosItems(items, type) {
            const ordered = [];
            ['CNBG', 'EBG'].forEach(bg => groupEosItems(items.filter(item => item.bg === bg), 'customer').forEach(customerGroup => groupEosItems(customerGroup[1], 'productLine').forEach(lineGroup => {
                if (type === 'product') sortEosItems(lineGroup[1]).forEach(item => ordered.push(item));
                else groupEosItems(lineGroup[1], 'product').forEach(productGroup => sortEosItems(productGroup[1]).forEach(item => ordered.push(item)));
            })));
            return ordered;
        }
        function xlsxTopNoPlan(metric, type) {
            if (!metric.noPlan) return '-';
            return topNoPlanGroups(metric, type).map(group => '[' + group.customer + ' · ' + tr('无计划中继续收编 ', 'Continue from No Plan ') + group.continueCount + ']\n' + group.items.map((entry, index) => (index + 1) + '. ' + entry[0] + ' · ' + entry[1] + ' (' + (entry[1] / group.noPlan * 100).toFixed(1) + '%)').join('\n')).join('\n') || '-';
        }
        function xlsxTopNoPlanHeight(metric, type) {
            const lines = topNoPlanGroups(metric, type).reduce((total, group) => total + 1 + group.items.length, 0);
            return Math.min(240, Math.max(36, 10 + lines * 12));
        }
        function exportEosWorkbook(productRows, versionRows, productItems, versionItems, summary) {
            const cell = (v, s) => ({ v, s }); const rate = (metric, includePlan) => eosRate(metric, includePlan).toFixed(1) + '%';
            const rateStyle = (metric, type, includePlan) => metric.quantity && eosRate(metric, includePlan) >= eosSettings.targets[type] ? 5 : 6;
            const progressRows = [
                { height: 28, cells: [cell(tr('EOS 收编分析报告', 'EOS Incorporation Analysis Report'), 1)] },
                { cells: [cell(tr('生成时间', 'Generated at') + ': ' + new Date().toLocaleString(uiLanguage === 'en' ? 'en-US' : 'zh-CN'), 7)] },
                { cells: [cell(tr('目标设置', 'Targets') + ': ' + tr('产品 ', 'Product ') + eosSettings.targets.product + '% · ' + tr('版本 ', 'Version ') + eosSettings.targets.version + '% · ' + tr('产品 Top ', 'Product Top ') + eosSettings.topN.product + ' · ' + tr('版本 Top ', 'Version Top ') + eosSettings.topN.version, 7)] },
                { cells: [''] },
                { cells: [cell(tr('客户 / BG', 'Customer / BG'), 2), cell(tr('产品', 'Product'), 2), '', '', '', '', '', '', cell(tr('版本', 'Version'), 8)] },
                { cells: [cell(tr('客户 / BG', 'Customer / BG'), 2), cell(tr('数量', 'Quantity'), 2), cell(tr('收编率', 'Rate'), 2), cell(tr('待收编', 'Pending'), 2), cell(tr('今年计划', 'Plan This Year'), 2), cell(tr('无计划', 'No Plan'), 2), cell(tr('预计收编率', 'Projected Rate'), 2), cell(tr('各客户无计划 Top ', 'Each Customer No Plan Top ') + eosSettings.topN.product, 2), cell(tr('数量', 'Quantity'), 2), cell(tr('收编率', 'Rate'), 2), cell(tr('待收编', 'Pending'), 2), cell(tr('今年计划', 'Plan This Year'), 2), cell(tr('无计划', 'No Plan'), 2), cell(tr('预计收编率', 'Projected Rate'), 2), cell(tr('各客户无计划 Top ', 'Each Customer No Plan Top ') + eosSettings.topN.version, 2)] }
            ];
            function appendProgress(name, bucket, style) {
                const topStyle = style === 3 ? 12 : style === 9 ? 13 : 11;
                const isCustomer = style === 10; const productTop = isCustomer ? xlsxTopNoPlan(bucket.product, 'product') : '—'; const versionTop = isCustomer ? xlsxTopNoPlan(bucket.version, 'version') : '—';
                const height = isCustomer ? Math.max(xlsxTopNoPlanHeight(bucket.product, 'product'), xlsxTopNoPlanHeight(bucket.version, 'version')) : 36;
                progressRows.push({ height, cells: [cell(name, style), cell(bucket.product.quantity, style), cell(rate(bucket.product, false), rateStyle(bucket.product, 'product', false)), cell(bucket.product.pending, style), cell(bucket.product.annualPlan, 4), cell(bucket.product.noPlan, style), cell(rate(bucket.product, true), rateStyle(bucket.product, 'product', true)), cell(productTop, topStyle), cell(bucket.version.quantity, style), cell(rate(bucket.version, false), rateStyle(bucket.version, 'version', false)), cell(bucket.version.pending, style), cell(bucket.version.annualPlan, 4), cell(bucket.version.noPlan, style), cell(rate(bucket.version, true), rateStyle(bucket.version, 'version', true)), cell(versionTop, topStyle)] });
            }
            ['CNBG', 'EBG'].forEach(bg => {
                appendProgress(bg, summary[bg], 3);
                Object.keys(summary.customers).filter(name => { const item = summary.customers[name]; return customerBG(name) === bg && (item.product.quantity || item.version.quantity || item.product.pending || item.version.pending); }).sort((left, right) => {
                    const leftPending = summary.customers[left].product.pending + summary.customers[left].version.pending; const rightPending = summary.customers[right].product.pending + summary.customers[right].version.pending;
                    return rightPending - leftPending || left.localeCompare(right, 'zh-CN');
                }).forEach(name => appendProgress('  └ ' + name, summary.customers[name], 10));
            });
            appendProgress('TOTAL', summary.TOTAL, 9);
            const briefTexts = [...views.eos.querySelectorAll('.nc-eos-brief')].map(section => [...section.querySelectorAll('p')].map(paragraph => paragraph.textContent.trim()).join('\n'));
            progressRows.push({ cells: [''] }, { cells: [cell(tr('产品收编总结与要求', 'Product Summary & Actions'), 8)] }, { height: 54, cells: [cell(briefTexts[0] || '', 7)] }, { cells: [cell(tr('版本收编总结与要求', 'Version Summary & Actions'), 8)] }, { height: 54, cells: [cell(briefTexts[1] || '', 7)] });
            function detailSheet(items, type) {
                const isProduct = type === 'product'; const headers = isProduct
                    ? ['BG', tr('客户', 'Customer'), tr('产品线', 'Product Line'), tr('产品', 'Product'), tr('数量', 'Quantity'), tr('已收编', 'Incorporated'), tr('收编率', 'Rate'), tr('待收编', 'Pending'), tr('今年计划完成数量', 'Planned This Year'), tr('无计划', 'No Plan'), tr('今年预计达成收编率', 'Projected Rate This Year'), tr('进展备注', 'Progress Note')]
                    : ['BG', tr('客户', 'Customer'), tr('产品线', 'Product Line'), tr('产品', 'Product'), tr('版本', 'Version'), tr('数量', 'Quantity'), tr('已收编', 'Incorporated'), tr('收编率', 'Rate'), tr('待收编', 'Pending'), tr('今年计划完成数量', 'Planned This Year'), tr('无计划', 'No Plan'), tr('今年预计达成收编率', 'Projected Rate This Year'), tr('进展备注', 'Progress Note')];
                const rows = [{ height: 28, cells: [cell(tr(isProduct ? 'EOS 产品表' : 'EOS 版本表', isProduct ? 'EOS Product Table' : 'EOS Version Table'), 1)] }, { cells: [cell(tr('包含全部数据；浅黄色为用户录入的今年计划，无计划由待收编减今年计划自动计算；最后一列为用户填写的进展备注。', 'Includes all records. Pale yellow highlights the user-entered annual plan; No Plan is calculated as Pending minus Planned This Year; the final column contains user-entered progress notes.'), 7)] }, { cells: headers.map(value => cell(value, 2)) }];
                orderedEosItems(items, type).forEach(item => {
                    const base = [item.bg, item.customer, item.productLine, item.product].map(value => cell(value, 10)); if (!isProduct) base.push(cell(item.label, 10));
                    base.push(cell(item.quantity, 10), cell(item.incorporated, 10), cell(rate(item, false), rateStyle(item, type, false)), cell(item.pending, 10));
                    base.push(cell(item.annualPlan, item.annualPlan > 0 ? 4 : 10), cell(item.noPlan, 10), cell(rate(item, true), rateStyle(item, type, true)), cell(item.progressNote, 7));
                    const noteLines = Math.max(1, String(item.progressNote || '').split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 28)), 0));
                    rows.push({ height: Math.min(90, Math.max(22, 8 + noteLines * 13)), cells: base });
                });
                return { rows, widths: isProduct ? [10, 18, 22, 28, 11, 11, 12, 11, 18, 11, 22, 38] : [10, 18, 22, 26, 26, 11, 11, 12, 11, 18, 11, 22, 38] };
            }
            const productSheet = detailSheet(productItems, 'product'); const versionSheet = detailSheet(versionItems, 'version');
            const rawHeaders = [tr('类型', 'Type'), tr('客户', 'Customer'), 'BG', tr('产品线', 'Product Line'), tr('产品', 'Product'), tr('版本', 'Version'), tr('数量', 'Quantity'), tr('已收编', 'Incorporated'), tr('待收编', 'Pending'), tr('阶段', 'Phase')];
            const rawSheetRows = [{ height: 28, cells: [cell(tr('EOS 原始数据', 'EOS Raw Data'), 1)] }, { cells: rawHeaders.map(value => cell(value, 2)) }];
            function appendRaw(rows, type) { rows.forEach(row => { const quantity = firstNumber(row, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']); rawSheetRows.push({ cells: [tr(type === 'product' ? '产品' : '版本', type === 'product' ? 'Product' : 'Version'), normalizeCustomer(row.customer_name), customerBG(row.customer_name), row.product_line_name || row.product_line_map || '', row.product_name || '', row.software_version || '', quantity, eosIncorporated(row, type, quantity), num(row.to_be_incorporated_nes), row.current_phase_name || row.current_phase || ''].map(value => cell(value, 10)) }); }); }
            appendRaw(productRows, 'product'); appendRaw(versionRows, 'version');
            const sheetNames = [tr('进展', 'Progress'), tr('产品表', 'Products'), tr('版本表', 'Versions'), tr('原始数据', 'Raw Data')];
            const files = {
                '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheetNames.map((name, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>',
                '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
                'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheetNames.map((name, index) => '<sheet name="' + xlsxXml(name) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join('') + '</sheets></workbook>',
                'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheetNames.map((name, index) => '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>').join('') + '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
                'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="6"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FF92400E"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FF166534"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFB91C1C"/><sz val="10"/><name val="Arial"/></font></fonts><fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0369A1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="5" fillId="7" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
            };
            files['xl/styles.xml'] = files['xl/styles.xml']
                .replace('<fonts count="6">', '<fonts count="8">')
                .replace('</fonts>', '<font><color rgb="FF334155"/><sz val="8"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="8"/><name val="Arial"/></font></fonts>')
                .replace('<cellXfs count="11">', '<cellXfs count="14">')
                .replace('<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"/>', '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>')
                .replace('<alignment horizontal="center"/></xf><xf numFmtId="0" fontId="4"', '<alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="4"')
                .replace('<alignment horizontal="center"/></xf><xf numFmtId="0" fontId="5"', '<alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="5"')
                .replace('<alignment horizontal="center"/></xf><xf numFmtId="0" fontId="0" fillId="8"', '<alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="8"')
                .replace('<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1"/>', '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>')
                .replace('<alignment vertical="center" wrapText="1"/></xf></cellXfs>', '<alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="7" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="7" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs>');
            files['xl/worksheets/sheet1.xml'] = buildXlsxSheet(progressRows, { widths: [22, 10, 12, 10, 13, 10, 14, 42, 10, 12, 10, 13, 10, 14, 42], merges: ['A1:O1', 'A2:O2', 'A3:O3', 'A5:A6', 'B5:H5', 'I5:O5', 'A' + (progressRows.length - 3) + ':O' + (progressRows.length - 3), 'A' + (progressRows.length - 2) + ':O' + (progressRows.length - 2), 'A' + (progressRows.length - 1) + ':O' + (progressRows.length - 1), 'A' + progressRows.length + ':O' + progressRows.length], freezeRows: 6 });
            files['xl/worksheets/sheet2.xml'] = buildXlsxSheet(productSheet.rows, { widths: productSheet.widths, merges: ['A1:L1', 'A2:L2'], freezeRows: 3, autoFilter: 'A3:L' + productSheet.rows.length });
            files['xl/worksheets/sheet3.xml'] = buildXlsxSheet(versionSheet.rows, { widths: versionSheet.widths, merges: ['A1:M1', 'A2:M2'], freezeRows: 3, autoFilter: 'A3:M' + versionSheet.rows.length });
            files['xl/worksheets/sheet4.xml'] = buildXlsxSheet(rawSheetRows, { widths: [12, 18, 10, 22, 28, 28, 11, 11, 11, 22], merges: ['A1:J1'], freezeRows: 2, autoFilter: 'A2:J' + rawSheetRows.length });
            const blob = new Blob([createXlsxZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); const link = document.createElement('a'); const url = URL.createObjectURL(blob); const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            link.href = url; link.download = (uiLanguage === 'en' ? 'EOS_Incorporation_Analysis_' : 'EOS收编分析_') + stamp + '.xlsx'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        function renderOriginalEosTable(productRows, versionRows) {
            const details = function (rows, kind) { return rows.map(row => { const quantity = firstNumber(row, ['incorporation_total_nes', 'annual_storage', 'capacities', 'current_inventory']); return '<tr><td>' + tr(kind === 'product' ? '产品' : '版本', kind === 'product' ? 'Product' : 'Version') + '</td><td>' + escapeHtml(normalizeCustomer(row.customer_name)) + '</td><td>' + customerBG(row.customer_name) + '</td><td>' + escapeHtml(row.product_line_name || row.product_line_map || '') + '</td><td>' + escapeHtml(row.product_name || '') + '</td><td>' + escapeHtml(row.software_version || '') + '</td><td>' + quantity + '</td><td>' + eosIncorporated(row, kind, quantity) + '</td><td>' + num(row.to_be_incorporated_nes) + '</td><td>' + escapeHtml(row.current_phase_name || row.current_phase || '') + '</td></tr>'; }).join(''); };
            return '<div class="nc-card"><div class="nc-card-title"><span>' + tr('EOS 原始明细', 'EOS Raw Details') + '</span><small>' + tr('产品 ', 'Products ') + productRows.length + tr(' 条 · 版本 ', ' rows · Versions ') + versionRows.length + tr(' 条', ' rows') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('类型', 'Type') + '</th><th>' + tr('客户', 'Customer') + '</th><th>BG</th><th>' + tr('产品线', 'Product Line') + '</th><th>' + tr('产品', 'Product') + '</th><th>' + tr('版本', 'Version') + '</th><th>' + tr('数量', 'Quantity') + '</th><th>' + tr('已收编', 'Incorporated') + '</th><th>' + tr('待收编', 'Pending') + '</th><th>' + tr('阶段', 'Phase') + '</th></tr></thead><tbody>' + details(productRows, 'product') + details(versionRows, 'version') + '</tbody></table></div></div>';
        }
        function bindEosStickyContexts() {
            views.eos.querySelectorAll('.nc-eos-table-wrap').forEach(wrapper => {
                const table = wrapper.querySelector('.nc-eos-detail-table'); const sticky = wrapper.querySelector('.nc-eos-sticky-context');
                if (!table || !sticky) return;
                const wrapperTop = wrapper.getBoundingClientRect().top;
                const hierarchyRows = [...table.querySelectorAll('tbody tr[data-sticky-level]')].map(row => ({ row, top: row.getBoundingClientRect().top - wrapperTop + wrapper.scrollTop })); let lastSignature = '';
                function updateStickyContext() {
                    const headerHeight = Math.ceil((table.tHead && table.tHead.getBoundingClientRect().height) || 29);
                    sticky.style.top = headerHeight + 'px'; sticky.style.width = wrapper.clientWidth + 'px';
                    const threshold = wrapper.scrollTop + headerHeight; const current = {};
                    hierarchyRows.forEach(entry => {
                        if (entry.top >= threshold) return;
                        const row = entry.row;
                        const level = row.dataset.stickyLevel; const label = row.dataset.stickyLabel || '';
                        if (level === 'bg') { current.bg = label; delete current.customer; delete current.line; delete current.product; }
                        else if (level === 'customer') { current.customer = label; delete current.line; delete current.product; }
                        else if (level === 'line') { current.line = label; delete current.product; }
                        else if (level === 'product') current.product = label;
                    });
                    const levels = ['bg', 'customer', 'line', 'product'].filter(level => current[level]); const signature = levels.map(level => level + ':' + current[level]).join('|');
                    if (signature === lastSignature) return;
                    lastSignature = signature; sticky.innerHTML = levels.map(level => '<div class="nc-eos-sticky-item ' + level + '">' + escapeHtml(current[level]) + '</div>').join('');
                }
                wrapper.addEventListener('scroll', updateStickyContext, { passive: true }); updateStickyContext();
            });
        }
        function applyEosFullscreen() {
            views.eos.querySelectorAll('.nc-eos-card').forEach(card => {
                const isFullscreen = card.dataset.eosCardType === eosFullscreenType;
                card.classList.toggle('nc-eos-fullscreen', isFullscreen);
                const control = card.querySelector('[data-table-fullscreen]');
                if (!control) return;
                control.textContent = isFullscreen ? tr('退出全屏', 'Exit Fullscreen') : tr('全屏', 'Fullscreen');
                control.setAttribute('aria-pressed', String(isFullscreen));
                control.title = isFullscreen ? tr('退出表格全屏', 'Exit table fullscreen') : tr('全屏查看表格', 'View table fullscreen');
            });
            document.body.classList.toggle('nc-eos-fullscreen-open', Boolean(eosFullscreenType));
        }
        function renderEos(productRows, versionRows) {
            const productItems = buildEosItems(productRows, 'product'); const versionItems = buildEosItems(versionRows, 'version');
            const summary = buildEos(productItems, versionItems);
            const customerNames = Object.keys(summary.customers).filter(name => { const item = summary.customers[name]; return item.product.quantity || item.version.quantity || item.product.pending || item.version.pending; });
            const childrenByBg = {};
            for (const bg of ['CNBG', 'EBG']) childrenByBg[bg] = customerNames.filter(name => customerBG(name) === bg).sort((a, b) => a.localeCompare(b, 'zh-CN')).map(name => eosRow(name, summary.customers[name], 'child')).join('');
            const topNControl = type => '<label>' + tr(type === 'product' ? '产品 Top N' : '版本 Top N', type === 'product' ? 'Product Top N' : 'Version Top N') + '<span class="nc-top-n-control"><button class="nc-top-n-step" type="button" data-eos-top-type="' + type + '" data-eos-top-step="-1">−</button><input class="nc-top-n-input" data-eos-top-type="' + type + '" type="number" min="1" max="99" step="1" value="' + eosSettings.topN[type] + '"><button class="nc-top-n-step" type="button" data-eos-top-type="' + type + '" data-eos-top-step="1">+</button></span></label>';
            const settingsHtml = '<div class="nc-eos-settings"><strong>' + tr('EOS 目标与排序', 'EOS Targets & Sorting') + '</strong><label>' + tr('产品目标 ', 'Product target ') + '<input class="nc-target-input" data-eos-target="product" type="number" min="0" max="100" step="0.1" value="' + eosSettings.targets.product + '">%</label><label>' + tr('版本目标 ', 'Version target ') + '<input class="nc-target-input" data-eos-target="version" type="number" min="0" max="100" step="0.1" value="' + eosSettings.targets.version + '">%</label>' + topNControl('product') + topNControl('version') + '<label>' + tr('待收编优先，同量时 ', 'Pending first; when tied ') + '<select class="nc-sort-select"><option value="quantity-desc"' + (eosSettings.sortMode === 'quantity-desc' ? ' selected' : '') + '>' + tr('数量由大到小', 'Quantity: high to low') + '</option><option value="rate-asc"' + (eosSettings.sortMode === 'rate-asc' ? ' selected' : '') + '>' + tr('收编率由低到高', 'Rate: low to high') + '</option></select></label><button class="nc-export-button" type="button" title="' + tr('导出进展、产品、版本及原始数据', 'Export progress, product, version, and raw data') + '">↗ ' + tr('导出 Excel', 'Export Excel') + '</button></div>';
            const overviewHtml = '<div class="nc-card"><div class="nc-card-title"><span>' + tr('EOS 产品及版本收编进展', 'EOS Product & Version Progress') + '</span><small>' + tr('产品 ', 'Products ') + productItems.length + tr(' 项 · 版本 ', ' items · Versions ') + versionItems.length + tr(' 项', ' items') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th rowspan="2">' + tr('客户 / BG', 'Customer / BG') + '</th><th colspan="7">' + tr('产品', 'Product') + ' <span class="nc-target">' + tr('目标 ', 'Target ') + eosSettings.targets.product + '%</span></th><th colspan="7">' + tr('版本', 'Version') + ' <span class="nc-target">' + tr('目标 ', 'Target ') + eosSettings.targets.version + '%</span></th></tr><tr><th>' + tr('数量', 'Quantity') + '</th><th>' + tr('收编率', 'Rate') + '</th><th>' + tr('待收编', 'Pending') + '</th><th>' + tr('今年计划', 'Plan This Year') + '</th><th>' + tr('无计划', 'No Plan') + '</th><th>' + tr('预计收编率', 'Projected Rate') + '</th><th>' + tr('各客户无计划 Top ', 'Each Customer No Plan Top ') + eosSettings.topN.product + '</th><th>' + tr('数量', 'Quantity') + '</th><th>' + tr('收编率', 'Rate') + '</th><th>' + tr('待收编', 'Pending') + '</th><th>' + tr('今年计划', 'Plan This Year') + '</th><th>' + tr('无计划', 'No Plan') + '</th><th>' + tr('预计收编率', 'Projected Rate') + '</th><th>' + tr('各客户无计划 Top ', 'Each Customer No Plan Top ') + eosSettings.topN.version + '</th></tr></thead><tbody>' + eosRow('CNBG', summary.CNBG, 'bg') + childrenByBg.CNBG + eosRow('EBG', summary.EBG, 'bg') + childrenByBg.EBG + eosRow('TOTAL', summary.TOTAL, 'total') + '</tbody></table></div><div class="nc-note">' + tr('产品与版本 Top N 独立设置，并从每个客户的无计划项中分别提取；单项占比以该客户无计划总量为分母。无计划 = 待收编 − 今年计划完成数量。计划数量按“客户 + 产品/版本”保存，范围为 0 至待收编数量；预计收编率 =（已收编 + 今年计划完成）÷ 数量。建议场景收编率 =（已收编 + 今年计划完成 + 无计划 Top N 继续收编数量）÷ 数量。已退网网元计入已收编。', 'Product and version Top N values are configured independently and selected from each customer’s No Plan items; item share is based on that customer’s total No Plan count. No Plan = Pending − Planned This Year. Plans are saved by customer and product/version, from 0 up to the pending count. Projected rate = (incorporated + planned this year) ÷ quantity. Suggested scenario rate = (incorporated + planned this year + continued incorporation from No Plan Top N) ÷ quantity. Deactivated NEs count as incorporated.') + '</div></div>';
            const briefsHtml = '<div class="nc-eos-briefs">' + renderEosBrief(productItems, summary.TOTAL.product, 'product') + renderEosBrief(versionItems, summary.TOTAL.version, 'version') + '</div>';
            views.eos.innerHTML = settingsHtml + overviewHtml + briefsHtml + renderEosItemTable(productItems, 'product') + renderEosItemTable(versionItems, 'version') + renderOriginalEosTable(productRows, versionRows);
            applyEosFullscreen();
            bindEosStickyContexts();
            views.eos.querySelectorAll('.nc-collapse-button').forEach(control => control.addEventListener('click', event => {
                const key = event.currentTarget.dataset.collapseKey;
                const wasCollapsed = eosSettings.collapsed[key] !== false;
                eosSettings.collapsed[key] = !wasCollapsed;
                if (wasCollapsed) {
                    try { eosFullscreenType = JSON.parse(key)[0]; } catch (error) {}
                }
                saveEosSettings(); renderEos(productRows, versionRows);
            }));
            views.eos.querySelectorAll('[data-table-fullscreen]').forEach(control => control.addEventListener('click', event => {
                const type = event.currentTarget.dataset.tableFullscreen;
                eosFullscreenType = eosFullscreenType === type ? null : type;
                renderEos(productRows, versionRows);
            }));
            views.eos.querySelectorAll('.nc-target-input').forEach(input => input.addEventListener('change', event => { const type = event.target.dataset.eosTarget; const value = Math.min(100, Math.max(0, num(event.target.value))); eosSettings.targets[type] = value; saveEosSettings(); renderEos(productRows, versionRows); }));
            function updateTopN(type, value) { eosSettings.topN[type] = Math.min(99, Math.max(1, Math.floor(num(value) || 1))); saveEosSettings(); renderEos(productRows, versionRows); }
            views.eos.querySelectorAll('.nc-top-n-input').forEach(input => input.addEventListener('change', event => updateTopN(event.target.dataset.eosTopType, event.target.value)));
            views.eos.querySelectorAll('[data-eos-top-step]').forEach(control => control.addEventListener('click', event => { const type = event.currentTarget.dataset.eosTopType; updateTopN(type, eosSettings.topN[type] + num(event.currentTarget.dataset.eosTopStep)); }));
            views.eos.querySelector('.nc-sort-select').addEventListener('change', event => { eosSettings.sortMode = event.target.value; saveEosSettings(); renderEos(productRows, versionRows); });
            views.eos.querySelector('.nc-export-button').addEventListener('click', event => {
                const button = event.currentTarget; const originalText = button.textContent; button.disabled = true; button.textContent = tr('正在生成…', 'Generating…');
                try { exportEosWorkbook(productRows, versionRows, productItems, versionItems, summary); button.textContent = tr('✓ 已导出', '✓ Exported'); }
                catch (error) { console.error('[NetCare] EOS Excel export failed:', error); button.textContent = tr('导出失败', 'Export failed'); }
                setTimeout(() => { if (button.isConnected) { button.disabled = false; button.textContent = originalText; } }, 1400);
            });
            function updatePlan(type, index, requestedValue) {
                const items = type === 'product' ? productItems : versionItems; const item = items[num(index)];
                if (!item) return;
                eosSettings.plans[type][item.key] = Math.min(item.pending, Math.max(0, Math.floor(num(requestedValue))));
                saveEosSettings(); renderEos(productRows, versionRows);
            }
            views.eos.querySelectorAll('.nc-plan-input').forEach(input => input.addEventListener('change', event => updatePlan(event.target.dataset.eosType, event.target.dataset.eosIndex, event.target.value)));
            views.eos.querySelectorAll('.nc-progress-note').forEach(input => input.addEventListener('input', event => {
                const type = event.target.dataset.noteType; const items = type === 'product' ? productItems : versionItems; const item = items[num(event.target.dataset.noteIndex)];
                if (!item) return;
                const value = String(event.target.value || '').slice(0, 500); item.progressNote = value;
                if (!eosSettings.notes[type]) eosSettings.notes[type] = {};
                if (value) eosSettings.notes[type][item.key] = value; else delete eosSettings.notes[type][item.key];
                saveEosSettings();
            }));
            views.eos.querySelectorAll('[data-plan-action]').forEach(control => control.addEventListener('click', event => {
                const type = event.currentTarget.dataset.eosType; const items = type === 'product' ? productItems : versionItems; const item = items[num(event.currentTarget.dataset.eosIndex)];
                if (!item) return;
                const action = event.currentTarget.dataset.planAction; let nextValue = item.annualPlan;
                if (action === 'minus') nextValue -= 1;
                else if (action === 'plus') nextValue += 1;
                else if (action === 'half') nextValue = Math.ceil(item.pending / 2);
                else if (action === 'all') nextValue = item.pending;
                else if (action === 'clear') nextValue = 0;
                updatePlan(type, event.currentTarget.dataset.eosIndex, nextValue);
            }));
            views.eos.querySelectorAll('[data-collapse-action]').forEach(control => control.addEventListener('click', event => {
                const type = event.currentTarget.dataset.collapseType; const collapse = event.currentTarget.dataset.collapseAction === 'collapse';
                const items = type === 'product' ? productItems : versionItems;
                items.forEach(item => {
                    eosSettings.collapsed[eosCollapseKey(type, item.bg, item.customer)] = collapse;
                    eosSettings.collapsed[eosCollapseKey(type, item.bg, item.customer, item.productLine || tr('未分类', 'Uncategorized'))] = collapse;
                });
                if (!collapse) eosFullscreenType = type;
                saveEosSettings(); renderEos(productRows, versionRows);
            }));
            views.eos.querySelectorAll('[data-bulk-action]').forEach(control => control.addEventListener('click', event => {
                const type = event.currentTarget.dataset.bulkType; const action = event.currentTarget.dataset.bulkAction;
                const items = type === 'product' ? productItems : versionItems; const pendingItems = items.filter(item => item.pending > 0);
                eosSettings.plans[type] = {};
                if (action === 'all') pendingItems.forEach(item => { eosSettings.plans[type][item.key] = item.pending; });
                else if (action === 'topn') groupEosItems(pendingItems, 'customer').forEach(customerGroup => [...customerGroup[1]].sort((left, right) => right.pending - left.pending || left.label.localeCompare(right.label, 'zh-CN')).slice(0, eosSettings.topN[type]).forEach(item => { eosSettings.plans[type][item.key] = item.pending; }));
                saveEosSettings(); renderEos(productRows, versionRows);
            }));
            saveEosSettings();
        }
        function certBucket() { return { total: 0, reduced: 0, products: {} }; }
        function renderCertificate(rows) {
            const products = new Set(); const productStats = new Map(); const summary = { CNBG: certBucket(), EBG: certBucket(), TOTAL: certBucket(), customers: {} };
            CONFIG.cnbgCustomers.forEach(name => { summary.customers[name] = certBucket(); });
            function add(bucket, row) { const product = row.product_line_map_name || row.product_line_name || tr('其他', 'Other'); const total = num(row.need_reduce_cnt); products.add(product); bucket.products[product] = (bucket.products[product] || 0) + total; bucket.total += total; bucket.reduced += num(row.reduced_cnt); }
            rows.forEach(row => { const customer = normalizeCustomer(row.customer_name); const bg = customerBG(customer); const product = row.product_line_map_name || row.product_line_name || tr('其他', 'Other'); const productStat = productStats.get(product) || { total: 0, reduced: 0 }; productStat.total += num(row.need_reduce_cnt); productStat.reduced += num(row.reduced_cnt); productStats.set(product, productStat); add(summary.TOTAL, row); add(summary[bg], row); if (bg === 'CNBG') { if (!summary.customers[customer]) summary.customers[customer] = certBucket(); add(summary.customers[customer], row); } });
            const productList = [...products].sort((a, b) => a.localeCompare(b, 'zh-CN'));
            function rowHtml(name, bucket, kind) { const pct = bucket.total ? bucket.reduced / bucket.total * 100 : 0; return '<tr class="' + (kind === 'total' ? 'nc-total' : kind === 'bg' ? 'nc-bg' : '') + '"><td class="nc-name ' + (kind === 'child' ? 'nc-child' : '') + '">' + (kind === 'child' ? '└ ' : '') + escapeHtml(name) + '</td>' + productList.map(product => '<td>' + (bucket.products[product] || 0) + '</td>').join('') + '<td>' + bucket.total + '</td><td>' + bucket.reduced + '</td><td class="' + (bucket.total ? 'nc-good' : 'nc-muted') + '">' + (bucket.total ? pct.toFixed(0) + '%' : '-') + '</td></tr>'; }
            const children = CONFIG.cnbgCustomers.filter(name => summary.customers[name].total).map(name => rowHtml(name, summary.customers[name], 'child')).join('');
            const details = rows.map(row => '<tr><td>' + escapeHtml(normalizeCustomer(row.customer_name)) + '</td><td>' + customerBG(row.customer_name) + '</td><td>' + escapeHtml(row.product_line_map_name || row.product_line_name || '') + '</td><td>' + escapeHtml(row.product_name || '') + '</td><td>' + escapeHtml(row.task_id || '') + '</td><td>' + num(row.need_reduce_cnt) + '</td><td>' + num(row.reduced_cnt) + '</td></tr>').join('');
            views.cert.innerHTML = '<div class="nc-card"><div class="nc-card-title"><span>' + (uiLanguage === 'en' ? CONFIG.certificateYear + ' Certificate Risk NE Cleanup Progress' : CONFIG.certificateYear + '年证书风险网元清理进展') + '</span><small>' + rows.length + tr(' 条', ' rows') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('客户 / BG', 'Customer / BG') + '</th>' + productList.map(product => '<th>' + escapeHtml(product) + '</th>').join('') + '<th>' + tr('总量', 'Total') + '</th><th>' + tr('已消减', 'Reduced') + '</th><th>' + tr('完成率', 'Completion Rate') + '</th></tr></thead><tbody>' + rowHtml('CNBG', summary.CNBG, 'bg') + children + rowHtml('EBG', summary.EBG, 'bg') + rowHtml('TOTAL', summary.TOTAL, 'total') + '</tbody></table></div></div><div class="nc-card"><div class="nc-card-title"><span>' + tr('证书明细', 'Certificate Details') + '</span><small>' + rows.length + tr(' 条', ' rows') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('客户', 'Customer') + '</th><th>BG</th><th>' + tr('产品线', 'Product Line') + '</th><th>' + tr('产品', 'Product') + '</th><th>Task</th><th>' + tr('需消减', 'To Reduce') + '</th><th>' + tr('已消减', 'Reduced') + '</th></tr></thead><tbody>' + details + '</tbody></table></div></div>';
            const certScopes = [{ name: 'CNBG', metric: summary.CNBG }, { name: 'EBG', metric: summary.EBG }, { name: tr('总体', 'Overall'), metric: summary.TOTAL }];
            const progressChart = renderSrBarChart(tr('各范围证书清理进展', 'Certificate Cleanup by Scope'), certScopes.map(item => item.name), [
                { name: tr('需消减', 'To reduce'), color: '#64748b', values: certScopes.map(item => item.metric.total) },
                { name: tr('已消减', 'Reduced'), color: '#34d399', values: certScopes.map(item => item.metric.reduced) }
            ]);
            const topProducts = [...productStats.entries()].sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0], 'zh-CN')).slice(0, 6);
            const productChart = renderSrBarChart(tr('重点产品线消减进展 Top 6', 'Top 6 Product-line Cleanup'), topProducts.map(item => chartShortLabel(item[0])), [
                { name: tr('需消减', 'To reduce'), color: '#64748b', values: topProducts.map(item => item[1].total) },
                { name: tr('已消减', 'Reduced'), color: '#38bdf8', values: topProducts.map(item => item[1].reduced) }
            ]);
            const certCards = [...views.cert.querySelectorAll('.nc-card')];
            [[certCards[0], progressChart], [certCards[1], productChart]].forEach(entry => { const card = entry[0]; if (!card) return; const tableWrap = card.querySelector('.nc-table-wrap'); if (!tableWrap) return; const grid = document.createElement('div'); grid.className = 'nc-sr-analysis-grid'; tableWrap.parentNode.insertBefore(grid, tableWrap); grid.appendChild(tableWrap); grid.insertAdjacentHTML('beforeend', entry[1]); });
        }
        function renderChange(data) {
            const map = new Map(data.rows.map(row => [row.scope + '|' + row.year + '|' + row.month, row]));
            const scopes = [{ key: 'TOTAL', name: tr('总体', 'Overall') }, { key: 'CNBG', name: tr('CNBG（运营商）', 'CNBG (Carrier)') }, { key: 'EBG', name: 'EBG' }];
            const currentBus = Array.isArray(data.bus) ? data.bus : [];
            const currentBusLabel = currentBus.length ? currentBus.join(uiLanguage === 'en' ? ', ' : '、') : tr('全部 BU', 'All BUs');
            const currentProductLines = Array.isArray(data.productLines) ? data.productLines : [];
            const currentProductLineLabel = currentProductLines.length ? currentProductLines.map(productLineLabel).join(uiLanguage === 'en' ? ', ' : '、') : tr('全部产品线', 'All Product Lines');
            const filterHtml = '<div class="nc-change-filter"><div class="nc-change-filter-head"><strong>' + tr('筛选变更数据', 'Filter Change Data') + '</strong><small>' + tr('当前数据范围：', 'Current data: ') + escapeHtml(currentBusLabel + ' · ' + currentProductLineLabel) + '</small></div>'
                + '<div class="nc-filter-row"><div class="nc-filter-label">BU</div><div class="nc-bu-controls"><button class="nc-bu-all nc-change-bu-all' + (!changeBuSelection.length ? ' active' : '') + '" type="button">' + tr('全部 BU', 'All BUs') + '</button>' + CHANGE_BU_OPTIONS.map(value => '<label class="nc-bu-chip"><input type="checkbox" data-change-bu="' + escapeHtml(value) + '"' + (changeBuSelection.includes(value) ? ' checked' : '') + '> ' + escapeHtml(value) + '</label>').join('') + '</div></div>'
                + '<div class="nc-filter-row"><div class="nc-filter-label">' + tr('产品线', 'Product Line') + '</div><div class="nc-bu-controls"><button class="nc-bu-all nc-change-product-line-all' + (!changeProductLineSelection.length ? ' active' : '') + '" type="button">' + tr('全部产品线', 'All Product Lines') + '</button>' + CHANGE_PRODUCT_LINE_OPTIONS.map(value => '<label class="nc-bu-chip" title="' + escapeHtml(value) + '"><input type="checkbox" data-change-product-line="' + escapeHtml(value) + '"' + (changeProductLineSelection.includes(value) ? ' checked' : '') + '> ' + escapeHtml(productLineLabel(value)) + '</label>').join('') + '<button class="nc-bu-apply" type="button">' + tr('按所选条件查询', 'Query Selected Filters') + '</button></div></div>'
                + '<div class="nc-bu-note">' + tr('BU 与产品线均可单选或多选；某一项未选择表示该维度全部，两个维度会联合过滤。', 'Select one or multiple BUs and product lines. No selection means all values in that dimension; both dimensions are combined.') + '</div></div>';
            const value = (scope, year, month) => num((map.get(scope + '|' + year + '|' + month) || {}).task_count);
            const sum = (scope, year, months) => months.reduce((total, month) => total + value(scope, year, month), 0);
            const ytd = Array.from({ length: data.currentMonth }, (_, index) => index + 1);
            const annual = scopes.map(scope => { const previousFull = sum(scope.key, data.previousYear, Array.from({ length: 12 }, (_, index) => index + 1)); const previousYtd = sum(scope.key, data.previousYear, ytd); const currentYtd = sum(scope.key, data.currentYear, ytd); return '<tr><td class="nc-name">' + scope.name + '</td><td>' + previousFull + '</td><td>' + previousYtd + '</td><td>' + currentYtd + '</td><td>' + formatChange(currentYtd, previousYtd) + '</td></tr>'; }).join('');
            const quarters = []; const completedQuarters = Math.floor((data.currentMonth - 1) / 3);
            scopes.forEach(scope => { for (let quarter = 1; quarter <= completedQuarters; quarter++) { const months = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3]; const current = sum(scope.key, data.currentYear, months); const previous = sum(scope.key, data.previousYear, months); const previousQuarter = quarter === 1 ? sum(scope.key, data.previousYear, [10, 11, 12]) : sum(scope.key, data.currentYear, months.map(month => month - 3)); quarters.push('<tr><td class="nc-name">' + scope.name + '</td><td>Q' + quarter + '</td><td>' + previous + '</td><td>' + current + '</td><td>' + formatChange(current, previous) + '</td><td>' + previousQuarter + '</td><td>' + formatChange(current, previousQuarter) + '</td></tr>'); } });
            const details = [];
            for (const year of [data.currentYear, data.previousYear]) {
                const maxMonth = year === data.currentYear ? data.currentMonth : 12;
                for (let month = maxMonth; month >= 1; month--) {
                    for (const scope of scopes) {
                        const item = map.get(scope.key + '|' + year + '|' + month) || {};
                        const rate = item.operation_success_rate != null
                            ? ((num(item.operation_success_rate) <= 1 ? num(item.operation_success_rate) * 100 : num(item.operation_success_rate)).toFixed(1)) + '%'
                            : '-';
                        details.push(
                            '<tr class="' + (scope.key === 'TOTAL' ? 'nc-total' : '') + '">'
                            + '<td class="nc-name">' + year + '-' + pad2(month) + '</td>'
                            + '<td class="nc-name">' + scope.name + '</td>'
                            + '<td>' + num(item.task_count) + '</td>'
                            + '<td>' + rate + '</td>'
                            + '<td>' + num(item.rollback_count) + '</td>'
                            + '<td>' + num(item.high_core_total_count) + '</td>'
                            + '</tr>'
                        );
                    }
                }
            }
            views.change.innerHTML = '<div class="nc-card"><div class="nc-card-title"><span>' + tr('年度操作数量同比', 'Annual Operation Volume YoY') + '</span><small>' + tr('截至 ', 'Through ') + data.currentYear + '-' + pad2(data.currentMonth) + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>' + data.previousYear + tr('全年', ' Full Year') + '</th><th>' + data.previousYear + tr('同期', ' YTD') + '</th><th>' + data.currentYear + tr('累计', ' YTD') + '</th><th>' + tr('同比', 'YoY') + '</th></tr></thead><tbody>' + annual + '</tbody></table></div></div><div class="nc-card"><div class="nc-card-title"><span>' + tr('季度同比 / 环比', 'Quarterly YoY / QoQ') + '</span><small>' + tr('仅完整季度', 'Completed quarters only') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>' + tr('季度', 'Quarter') + '</th><th>' + tr('上年同期', 'Prior-year Quarter') + '</th><th>' + tr('本年', 'Current Year') + '</th><th>' + tr('同比', 'YoY') + '</th><th>' + tr('上季度', 'Previous Quarter') + '</th><th>' + tr('环比', 'QoQ') + '</th></tr></thead><tbody>' + (quarters.join('') || '<tr><td colspan="7" class="nc-muted">' + tr('暂无完整季度', 'No completed quarter') + '</td></tr>') + '</tbody></table></div></div><div class="nc-card"><div class="nc-card-title"><span>' + tr('月度变更明细', 'Monthly Change Details') + '</span><small>' + tr('分 BG · 操作量、成功率、回退及高危核心', 'By BG · Volume, success rate, rollback & high-risk core') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('月份', 'Month') + '</th><th>' + tr('范围', 'Scope') + '</th><th>' + tr('变更量', 'Changes') + '</th><th>' + tr('成功率', 'Success Rate') + '</th><th>' + tr('回退', 'Rollback') + '</th><th>' + tr('高危核心', 'High-risk Core') + '</th></tr></thead><tbody>' + details.join('') + '</tbody></table></div></div>';
            views.change.insertAdjacentHTML('afterbegin', filterHtml);
            const quarterLabels = Array.from({ length: completedQuarters }, (_, index) => 'Q' + (index + 1));
            const quarterMonths = quarter => [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
            const annualChart = renderSrBarChart(tr('各范围年度同期对比', 'YTD Comparison by Scope'), scopes.map(scope => scope.name), [
                { name: String(data.previousYear), color: '#64748b', values: scopes.map(scope => sum(scope.key, data.previousYear, ytd)) },
                { name: String(data.currentYear), color: '#38bdf8', values: scopes.map(scope => sum(scope.key, data.currentYear, ytd)) }
            ]);
            const quarterChart = renderSrBarChart(tr('总体季度同比与环比', 'Overall Quarter YoY & QoQ'), quarterLabels, [
                { name: tr('上年同期', 'Prior year'), color: '#64748b', values: quarterLabels.map((label, index) => sum('TOTAL', data.previousYear, quarterMonths(index + 1))) },
                { name: tr('本年', 'Current'), color: '#38bdf8', values: quarterLabels.map((label, index) => sum('TOTAL', data.currentYear, quarterMonths(index + 1))) },
                { name: tr('上季度', 'Prior quarter'), color: '#fbbf24', values: quarterLabels.map((label, index) => index ? sum('TOTAL', data.currentYear, quarterMonths(index)) : sum('TOTAL', data.previousYear, [10, 11, 12])) }
            ]);
            const monthLabels = ytd.map(month => pad2(month));
            const monthlyChart = renderSrLineChart(tr('月度变更量同期趋势', 'Monthly Change YoY Trend'), monthLabels, [
                { name: String(data.previousYear), color: '#64748b', values: ytd.map(month => value('TOTAL', data.previousYear, month)) },
                { name: String(data.currentYear), color: '#38bdf8', values: ytd.map(month => value('TOTAL', data.currentYear, month)) }
            ]);
            const changeCards = [...views.change.querySelectorAll('.nc-card')];
            [[changeCards[0], annualChart], [changeCards[1], quarterChart], [changeCards[2], monthlyChart]].forEach(entry => { const card = entry[0]; if (!card) return; const tableWrap = card.querySelector('.nc-table-wrap'); if (!tableWrap) return; const grid = document.createElement('div'); grid.className = 'nc-sr-analysis-grid'; tableWrap.parentNode.insertBefore(grid, tableWrap); grid.appendChild(tableWrap); grid.insertAdjacentHTML('beforeend', entry[1]); });
            const allButton = views.change.querySelector('.nc-change-bu-all'); const buInputs = [...views.change.querySelectorAll('[data-change-bu]')];
            const productLineAllButton = views.change.querySelector('.nc-change-product-line-all'); const productLineInputs = [...views.change.querySelectorAll('[data-change-product-line]')];
            function syncBuDraft() {
                changeBuSelection = buInputs.filter(input => input.checked).map(input => input.dataset.changeBu);
                allButton.classList.toggle('active', !changeBuSelection.length); saveChangeBuSelection();
            }
            function syncProductLineDraft() {
                changeProductLineSelection = productLineInputs.filter(input => input.checked).map(input => input.dataset.changeProductLine);
                productLineAllButton.classList.toggle('active', !changeProductLineSelection.length); saveChangeProductLineSelection();
            }
            buInputs.forEach(input => input.addEventListener('change', syncBuDraft));
            allButton.addEventListener('click', () => { buInputs.forEach(input => { input.checked = false; }); syncBuDraft(); });
            productLineInputs.forEach(input => input.addEventListener('change', syncProductLineDraft));
            productLineAllButton.addEventListener('click', () => { productLineInputs.forEach(input => { input.checked = false; }); syncProductLineDraft(); });
            views.change.querySelector('.nc-bu-apply').addEventListener('click', reloadChangeData);
        }
        async function reloadChangeData() {
            if (loading || changeLoading || srLoading || destroyed) return;
            if (simulationMode) { modeStatus.textContent = tr('模拟浮窗不访问正式接口，请导入 JSON 回顾历史数据。', 'Simulation does not call live APIs. Import JSON to review historical data.'); return; }
            const token = findCsrfToken();
            if (!token) { modeStatus.textContent = tr('未找到 csrfToken，请刷新 NetCare 页面后重试。', 'csrfToken not found. Refresh the NetCare page and try again.'); return; }
            leaveReviewMode();
            changeLoading = true; const applyButton = views.change.querySelector('.nc-bu-apply');
            if (applyButton) { applyButton.disabled = true; applyButton.textContent = tr('正在查询…', 'Querying…'); }
            modeStatus.textContent = tr('正在按所选 BU 和产品线获取变更数量…', 'Loading change volume for selected BUs and product lines…');
            try {
                const result = await loadChangeData(token, changeBuSelection, changeProductLineSelection);
                if (destroyed) return;
                if (dashboardCache) dashboardCache[3] = result;
                renderChange(result);
                modeStatus.textContent = dashboardCache ? dashboardStatus(dashboardCache) : tr('变更数量已更新', 'Change volume updated');
            } catch (error) {
                modeStatus.textContent = tr('变更筛选数据获取失败：', 'Failed to load filtered change data: ') + (error && error.message || String(error));
                console.error('[NetCare] Filtered change data request failed:', error);
            } finally {
                changeLoading = false; const currentButton = views.change.querySelector('.nc-bu-apply'); if (currentButton) { currentButton.disabled = false; currentButton.textContent = tr('按所选条件查询', 'Query Selected Filters'); }
            }
        }
        function renderInterception(data) {
            const map = new Map(data.rows.map(row => [row.scope + '|' + row.year + '|' + row.month, row]));
            const scopes = interceptionDistinguishBG ? [{ key: 'TOTAL', name: tr('总体', 'Overall') }, { key: 'CNBG', name: 'CNBG' }, { key: 'EBG', name: 'EBG' }] : [{ key: 'TOTAL', name: tr('总体', 'Overall') }];
            const metrics = [{ field: 'interception_cnt', name: tr('拦截总量', 'Total Interceptions') }, { field: 'commands_interception_cnt', name: tr('命令行拦截', 'Command-line') }, { field: 'graphical_interception_cnt', name: tr('图形化拦截', 'Graphical') }];
            const value = (scope, year, month, field) => num((map.get(scope + '|' + year + '|' + month) || {})[field]);
            const sum = (scope, year, months, field) => months.reduce((total, month) => total + value(scope, year, month, field), 0);
            const ytd = Array.from({ length: data.currentMonth }, (_, index) => index + 1); const full = Array.from({ length: 12 }, (_, index) => index + 1);
            const annual = []; scopes.forEach(scope => metrics.forEach(metric => { const previousFull = sum(scope.key, data.previousYear, full, metric.field); const previousYtd = sum(scope.key, data.previousYear, ytd, metric.field); const currentYtd = sum(scope.key, data.currentYear, ytd, metric.field); annual.push('<tr><td class="nc-name">' + scope.name + '</td><td class="nc-name">' + metric.name + '</td><td>' + previousFull + '</td><td>' + previousYtd + '</td><td>' + currentYtd + '</td><td>' + formatChange(currentYtd, previousYtd) + '</td></tr>'); }));
            const quarters = []; const completed = Math.floor((data.currentMonth - 1) / 3); scopes.forEach(scope => metrics.forEach(metric => { for (let quarter = 1; quarter <= completed; quarter++) { const months = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3]; const current = sum(scope.key, data.currentYear, months, metric.field); const previous = sum(scope.key, data.previousYear, months, metric.field); const previousQuarter = quarter === 1 ? sum(scope.key, data.previousYear, [10, 11, 12], metric.field) : sum(scope.key, data.currentYear, months.map(month => month - 3), metric.field); quarters.push('<tr><td>' + scope.name + '</td><td>' + metric.name + '</td><td>Q' + quarter + '</td><td>' + previous + '</td><td>' + current + '</td><td>' + formatChange(current, previous) + '</td><td>' + previousQuarter + '</td><td>' + formatChange(current, previousQuarter) + '</td></tr>'); } }));
            const details = []; for (const year of [data.currentYear, data.previousYear]) { const maxMonth = year === data.currentYear ? data.currentMonth : 12; for (let month = maxMonth; month >= 1; month--) for (const scope of scopes) details.push('<tr><td>' + year + '-' + pad2(month) + '</td><td>' + scope.name + '</td><td>' + value(scope.key, year, month, 'interception_cnt') + '</td><td>' + value(scope.key, year, month, 'commands_interception_cnt') + '</td><td>' + value(scope.key, year, month, 'graphical_interception_cnt') + '</td></tr>'); }
            views.interception.innerHTML = '<label class="nc-option"><input class="nc-bg-toggle" type="checkbox" ' + (interceptionDistinguishBG ? 'checked' : '') + '> ' + tr('区分 BG 统计', 'Break down by BG') + '</label><div class="nc-card"><div class="nc-card-title"><span>' + tr('高危拦截年度同期同比', 'High-risk Interception Annual YoY') + '</span><small>' + tr('截至 ', 'Through ') + data.currentYear + '-' + pad2(data.currentMonth) + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>' + tr('指标', 'Metric') + '</th><th>' + tr('上年全年', 'Prior Full Year') + '</th><th>' + tr('上年同期', 'Prior YTD') + '</th><th>' + tr('本年累计', 'Current YTD') + '</th><th>' + tr('同比', 'YoY') + '</th></tr></thead><tbody>' + annual.join('') + '</tbody></table></div></div><div class="nc-card"><div class="nc-card-title"><span>' + tr('季度同比 / 环比', 'Quarterly YoY / QoQ') + '</span><small>' + tr('仅完整季度', 'Completed quarters only') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>' + tr('指标', 'Metric') + '</th><th>' + tr('季度', 'Quarter') + '</th><th>' + tr('上年同期', 'Prior-year Quarter') + '</th><th>' + tr('本年', 'Current Year') + '</th><th>' + tr('同比', 'YoY') + '</th><th>' + tr('上季度', 'Previous Quarter') + '</th><th>' + tr('环比', 'QoQ') + '</th></tr></thead><tbody>' + (quarters.join('') || '<tr><td colspan="8" class="nc-muted">' + tr('暂无完整季度', 'No completed quarter') + '</td></tr>') + '</tbody></table></div></div><div class="nc-card"><div class="nc-card-title"><span>' + tr('高危拦截月度明细', 'Monthly High-risk Interception Details') + '</span></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('月份', 'Month') + '</th><th>' + tr('范围', 'Scope') + '</th><th>' + tr('总量', 'Total') + '</th><th>' + tr('命令行', 'Command-line') + '</th><th>' + tr('图形化', 'Graphical') + '</th></tr></thead><tbody>' + details.join('') + '</tbody></table></div></div>';
            const quarterLabels = Array.from({ length: completed }, (_, index) => 'Q' + (index + 1)); const quarterMonths = quarter => [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
            const annualChart = renderSrBarChart(tr('总体各类拦截年度同期', 'Overall Interception YTD by Type'), metrics.map(metric => metric.name), [
                { name: String(data.previousYear), color: '#64748b', values: metrics.map(metric => sum('TOTAL', data.previousYear, ytd, metric.field)) },
                { name: String(data.currentYear), color: '#f87171', values: metrics.map(metric => sum('TOTAL', data.currentYear, ytd, metric.field)) }
            ]);
            const quarterChart = renderSrBarChart(tr('总体拦截量季度同比与环比', 'Overall Interception Quarter YoY & QoQ'), quarterLabels, [
                { name: tr('上年同期', 'Prior year'), color: '#64748b', values: quarterLabels.map((label, index) => sum('TOTAL', data.previousYear, quarterMonths(index + 1), 'interception_cnt')) },
                { name: tr('本年', 'Current'), color: '#f87171', values: quarterLabels.map((label, index) => sum('TOTAL', data.currentYear, quarterMonths(index + 1), 'interception_cnt')) },
                { name: tr('上季度', 'Prior quarter'), color: '#fbbf24', values: quarterLabels.map((label, index) => index ? sum('TOTAL', data.currentYear, quarterMonths(index), 'interception_cnt') : sum('TOTAL', data.previousYear, [10, 11, 12], 'interception_cnt')) }
            ]);
            const monthLabels = ytd.map(month => pad2(month));
            const monthlyChart = renderSrLineChart(tr('本年高危拦截月度构成', 'Current-year Monthly Interception Mix'), monthLabels, [
                { name: tr('总量', 'Total'), color: '#f87171', values: ytd.map(month => value('TOTAL', data.currentYear, month, 'interception_cnt')) },
                { name: tr('命令行', 'Command-line'), color: '#fbbf24', showValues: false, values: ytd.map(month => value('TOTAL', data.currentYear, month, 'commands_interception_cnt')) },
                { name: tr('图形化', 'Graphical'), color: '#38bdf8', showValues: false, values: ytd.map(month => value('TOTAL', data.currentYear, month, 'graphical_interception_cnt')) }
            ]);
            const interceptionCards = [...views.interception.querySelectorAll('.nc-card')];
            [[interceptionCards[0], annualChart], [interceptionCards[1], quarterChart], [interceptionCards[2], monthlyChart]].forEach(entry => { const card = entry[0]; if (!card) return; const tableWrap = card.querySelector('.nc-table-wrap'); if (!tableWrap) return; const grid = document.createElement('div'); grid.className = 'nc-sr-analysis-grid'; tableWrap.parentNode.insertBefore(grid, tableWrap); grid.appendChild(tableWrap); grid.insertAdjacentHTML('beforeend', entry[1]); });
            views.interception.querySelector('.nc-bg-toggle').addEventListener('change', event => { interceptionDistinguishBG = event.target.checked; renderInterception(data); });
        }
        function srPercent(value) { const numeric = num(value); return (numeric <= 1 ? numeric * 100 : numeric).toFixed(1) + '%'; }
        function srTypeShortName(value) {
            return ({ 'Technical Request-Others': 'Others', 'Technical Request-POC': 'POC', 'CS - Technical Request': 'CS', 'Technical Request-NRO': 'NRO', 'Technical Request - Cross Prod.': 'Cross Prod.', 'Technical Request - Cross Product': 'Cross Product', 'Technical Request - Platform': 'Platform', 'Technical Request - Third Party': 'Third Party', 'Technical Request - Service Delivery': 'Service Delivery' })[value] || value;
        }
        function chartShortLabel(value) { const label = String(value || ''); return label.length > 12 ? label.slice(0, 11) + '…' : label; }
        function srCompactNumber(value) { const number = num(value); return Math.abs(number) >= 1000 ? (number / 1000).toFixed(number >= 10000 ? 0 : 1) + 'k' : String(Math.round(number)); }
        function renderSrBarChart(title, labels, series) {
            const width = 480; const height = 210; const left = 40; const right = 10; const top = 34; const bottom = 34; const plotWidth = width - left - right; const plotHeight = height - top - bottom;
            const maximum = Math.max(1, ...series.flatMap(item => item.values.map(num))); const groupWidth = plotWidth / Math.max(1, labels.length); const barWidth = Math.min(24, groupWidth / (series.length + 1)); const parts = ['<title>' + escapeHtml(title) + '</title><text x="' + left + '" y="12" class="nc-sr-chart-title">' + escapeHtml(title) + '</text>'];
            [0, .5, 1].forEach(ratio => { const y = top + plotHeight * (1 - ratio); parts.push('<line x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '" class="nc-sr-chart-grid"/><text x="' + (left - 5) + '" y="' + (y + 3) + '" text-anchor="end" class="nc-sr-chart-axis">' + srCompactNumber(maximum * ratio) + '</text>'); });
            labels.forEach((label, labelIndex) => { const center = left + groupWidth * (labelIndex + .5); parts.push('<text x="' + center + '" y="' + (height - 10) + '" text-anchor="middle" class="nc-sr-chart-axis">' + escapeHtml(label) + '</text>'); series.forEach((item, seriesIndex) => { const value = num(item.values[labelIndex]); const barHeight = value / maximum * plotHeight; const x = center - series.length * barWidth / 2 + seriesIndex * barWidth; const y = top + plotHeight - barHeight; parts.push('<rect x="' + x + '" y="' + y + '" width="' + (barWidth - 2) + '" height="' + barHeight + '" rx="2" fill="' + item.color + '"/><text x="' + (x + (barWidth - 2) / 2) + '" y="' + Math.max(top + 7, y - 3) + '" text-anchor="middle" class="nc-sr-chart-value">' + srCompactNumber(value) + '</text>'); }); });
            series.forEach((item, index) => { const x = left + index * 110; parts.push('<rect x="' + x + '" y="19" width="7" height="7" rx="2" fill="' + item.color + '"/><text x="' + (x + 11) + '" y="26" class="nc-sr-chart-legend">' + escapeHtml(item.name) + '</text>'); });
            return '<div class="nc-sr-chart"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img">' + parts.join('') + '</svg></div>';
        }
        function renderSrLineChart(title, labels, series) {
            const width = 520; const height = 210; const left = 40; const right = 12; const top = 35; const bottom = 34; const plotWidth = width - left - right; const plotHeight = height - top - bottom; const maximum = Math.max(1, ...series.flatMap(item => item.values.map(num))); const step = labels.length > 1 ? plotWidth / (labels.length - 1) : 0; const parts = ['<title>' + escapeHtml(title) + '</title><text x="' + left + '" y="12" class="nc-sr-chart-title">' + escapeHtml(title) + '</text>'];
            [0, .5, 1].forEach(ratio => { const y = top + plotHeight * (1 - ratio); parts.push('<line x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '" class="nc-sr-chart-grid"/><text x="' + (left - 5) + '" y="' + (y + 3) + '" text-anchor="end" class="nc-sr-chart-axis">' + srCompactNumber(maximum * ratio) + '</text>'); });
            labels.forEach((label, index) => { const x = left + step * index; parts.push('<text x="' + x + '" y="' + (height - 10) + '" text-anchor="middle" class="nc-sr-chart-axis">' + escapeHtml(label) + '</text>'); });
            series.forEach((item, seriesIndex) => { const points = item.values.map((value, index) => (left + step * index) + ',' + (top + plotHeight - num(value) / maximum * plotHeight)); parts.push('<polyline points="' + points.join(' ') + '" fill="none" stroke="' + item.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>'); item.values.forEach((value, index) => { const x = left + step * index; const y = top + plotHeight - num(value) / maximum * plotHeight; const labelY = seriesIndex % 2 ? Math.max(top + 7, y - 6) : Math.min(top + plotHeight - 2, y + 12); parts.push('<circle cx="' + x + '" cy="' + y + '" r="3" fill="' + item.color + '"/>' + (item.showValues === false ? '' : '<text x="' + x + '" y="' + labelY + '" text-anchor="middle" class="nc-sr-chart-value">' + srCompactNumber(value) + '</text>')); }); });
            series.forEach((item, index) => { const x = left + index * 120; parts.push('<line x1="' + x + '" y1="22" x2="' + (x + 9) + '" y2="22" stroke="' + item.color + '" stroke-width="2.4"/><text x="' + (x + 13) + '" y="25" class="nc-sr-chart-legend">' + escapeHtml(item.name) + '</text>'); });
            return '<div class="nc-sr-chart"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img">' + parts.join('') + '</svg></div>';
        }
        function renderSr(data) {
            const summaryMap = new Map(data.summary.map(row => [row.period + '|' + row.scope, row])); const current = summaryMap.get('currentYtd|TOTAL') || normalizeSrRow({}, {}); const previous = summaryMap.get('previousYtd|TOTAL') || normalizeSrRow({}, {});
            const yoy = formatChange(current.sr_total, previous.sr_total); const severityTotal = current.minor_sr_cnt + current.major_sr_cnt + current.critical_sr_cnt || 1;
            function kpi(label, value, meta, tone) { return '<div class="nc-sr-kpi ' + (tone || '') + '"><div class="nc-sr-kpi-label">' + label + '</div><div class="nc-sr-kpi-value">' + value + '</div><div class="nc-sr-kpi-meta">' + meta + '</div></div>'; }
            const kpis = '<div class="nc-sr-kpis">'
                + kpi(tr('本年累计 SR', 'Current YTD SRs'), current.sr_total.toLocaleString('zh-CN'), tr('同比 ', 'YoY ') + yoy, '')
                + kpi('FRT', srPercent(current.sr_frt), tr('上年同期 ', 'Prior YTD ') + srPercent(previous.sr_frt), current.sr_frt >= .99 ? 'good' : 'warn')
                + kpi(tr('未关闭 SR', 'Open SRs'), current.unclose_sr_cnt.toLocaleString('zh-CN'), tr('5 日内到期 ', 'Due within 5 days ') + current.due_within_5days_sr_cnt, current.unclose_sr_cnt ? 'warn' : 'good')
                + kpi(tr('逾期 SR', 'Overdue SRs'), current.overdue_sr_cnt.toLocaleString('zh-CN'), tr('逾期未关闭 ', 'Overdue open ') + current.overdue_unclose_sr_cnt, current.overdue_sr_cnt ? 'bad' : 'good')
                + kpi(tr('紧急恢复', 'Emergency Recoveries'), current.emergency_recovery_cnt.toLocaleString('zh-CN'), tr('未恢复紧急 ', 'Unrecovered ') + current.unrecovered_emergency_cnt, current.unrecovered_emergency_cnt ? 'bad' : 'good')
                + kpi(tr('端到端解决时长', 'E2E Resolution Time'), current.e2e_report_to_resolve_dura.toFixed(2) + 'h', tr('上年同期 ', 'Prior YTD ') + previous.e2e_report_to_resolve_dura.toFixed(2) + 'h', '')
                + kpi(tr('序列号授权率', 'Serial Authorization'), srPercent(current.authed_rate), tr('授权中过保 ', 'Out-of-warranty among authorized ') + srPercent(current.auth_out_warranty_rate), current.authed_rate >= .9 ? 'good' : 'warn') + '</div>';
            const scopes = [{ key: 'TOTAL', label: tr('总体', 'Overall') }, { key: 'CNBG', label: 'CNBG' }, { key: 'EBG', label: 'EBG' }];
            const comparisonRows = scopes.map(scope => {
                const previousFull = summaryMap.get('previousFull|' + scope.key) || normalizeSrRow({}, {}); const prior = summaryMap.get('previousYtd|' + scope.key) || normalizeSrRow({}, {}); const now = summaryMap.get('currentYtd|' + scope.key) || normalizeSrRow({}, {});
                return '<tr class="' + (scope.key === 'TOTAL' ? 'nc-total' : '') + '"><td class="nc-name">' + scope.label + '</td><td>' + previousFull.sr_total + '</td><td>' + prior.sr_total + '</td><td>' + now.sr_total + '</td><td>' + formatChange(now.sr_total, prior.sr_total) + '</td><td>' + srPercent(now.sr_frt) + '</td><td>' + now.unclose_sr_cnt + '</td><td>' + now.overdue_sr_cnt + '</td><td>' + now.emergency_recovery_cnt + '</td><td>' + now.e2e_report_to_resolve_dura.toFixed(2) + 'h</td></tr>';
            }).join('');
            const severityHtml = '<div class="nc-card"><div class="nc-card-title"><span>' + tr('本年严重级别结构', 'Current-year Severity Mix') + '</span><small>' + tr('总体 SR 严重级别分布', 'Overall SR severity distribution') + '</small></div><div class="nc-sr-severity"><span class="nc-sr-minor" style="width:' + current.minor_sr_cnt / severityTotal * 100 + '%"></span><span class="nc-sr-major" style="width:' + current.major_sr_cnt / severityTotal * 100 + '%"></span><span class="nc-sr-critical" style="width:' + current.critical_sr_cnt / severityTotal * 100 + '%"></span></div><div class="nc-sr-legend"><span><i class="nc-sr-dot nc-sr-minor"></i>Minor ' + current.minor_sr_cnt + ' (' + (current.minor_sr_cnt / severityTotal * 100).toFixed(1) + '%)</span><span><i class="nc-sr-dot nc-sr-major"></i>Major ' + current.major_sr_cnt + ' (' + (current.major_sr_cnt / severityTotal * 100).toFixed(1) + '%)</span><span><i class="nc-sr-dot nc-sr-critical"></i>Critical ' + current.critical_sr_cnt + ' (' + (current.critical_sr_cnt / severityTotal * 100).toFixed(1) + '%)</span></div></div>';
            const dataTypes = Array.isArray(data.srTypes) ? data.srTypes : []; const dataTypeLabel = dataTypes.length ? dataTypes.map(srTypeShortName).join(uiLanguage === 'en' ? ', ' : '、') : tr('全部 SR 类型', 'All SR Types');
            const dataProductLines = Array.isArray(data.productLines) ? data.productLines : []; const dataProductLineLabel = dataProductLines.length ? dataProductLines.map(productLineLabel).join(uiLanguage === 'en' ? ', ' : '、') : tr('全部产品线', 'All Product Lines');
            const srFilterHtml = '<div class="nc-change-filter"><div class="nc-change-filter-head"><strong>' + tr('筛选 SR 数据', 'Filter SR Data') + '</strong><small>' + tr('当前数据范围：', 'Current data: ') + escapeHtml(dataTypeLabel + ' · ' + dataProductLineLabel) + '</small></div>'
                + '<div class="nc-filter-row"><div class="nc-filter-label">' + tr('SR 类型', 'SR Type') + '</div><div class="nc-bu-controls"><button class="nc-bu-all nc-sr-type-all' + (!srTypeSelection.length ? ' active' : '') + '" type="button">' + tr('全部类型', 'All Types') + '</button>' + SR_TYPE_NAMES.map(value => '<label class="nc-bu-chip" title="' + escapeHtml(value) + '"><input type="checkbox" data-sr-type="' + escapeHtml(value) + '"' + (srTypeSelection.includes(value) ? ' checked' : '') + '> ' + escapeHtml(srTypeShortName(value)) + '</label>').join('') + '</div></div>'
                + '<div class="nc-filter-row"><div class="nc-filter-label">' + tr('产品线', 'Product Line') + '</div><div class="nc-bu-controls"><button class="nc-bu-all nc-sr-product-line-all' + (!srProductLineSelection.length ? ' active' : '') + '" type="button">' + tr('全部产品线', 'All Product Lines') + '</button>' + SR_PRODUCT_LINE_OPTIONS.map(value => '<label class="nc-bu-chip" title="' + escapeHtml(value) + '"><input type="checkbox" data-sr-product-line="' + escapeHtml(value) + '"' + (srProductLineSelection.includes(value) ? ' checked' : '') + '> ' + escapeHtml(productLineLabel(value)) + '</label>').join('') + '<button class="nc-bu-apply" type="button">' + tr('按所选条件查询', 'Query Selected Filters') + '</button></div></div>'
                + '<div class="nc-bu-note">' + tr('SR 类型与产品线均可单选或多选；某一项未选择表示该维度全部，两个维度会联合过滤。本次查询只刷新 SR 专题。', 'Select one or multiple SR types and product lines. No selection means all values in that dimension; both dimensions are combined. Only the SR view is refreshed.') + '</div></div>';
            function changeValue(nowValue, priorValue) { const delta = num(nowValue) - num(priorValue); return { delta, text: (delta > 0 ? '+' : '') + delta.toLocaleString('zh-CN'), rate: priorValue ? (delta > 0 ? '+' : '') + (delta / priorValue * 100).toFixed(1) + '%' : (nowValue ? tr('新增', 'New') : '0%') }; }
            function renderVolumeChange(nowValue, priorValue) { const change = changeValue(nowValue, priorValue); return '<span class="' + (change.delta > 0 ? 'nc-bad' : change.delta < 0 ? 'nc-good' : 'nc-muted') + '">' + change.text + ' (' + change.rate + ')</span>'; }
            const annualChange = changeValue(current.sr_total, previous.sr_total); const volumeCompletedQuarters = Math.floor((data.currentMonth - 1) / 3); let latestQuarter = null; let latestQuarterPrior = null;
            if (volumeCompletedQuarters > 0) {
                const months = [volumeCompletedQuarters * 3 - 2, volumeCompletedQuarters * 3 - 1, volumeCompletedQuarters * 3];
                latestQuarter = aggregateSrRows(data.monthly.filter(row => row.scope === 'TOTAL' && row.year === data.currentYear && months.includes(row.month)));
                const priorMonths = volumeCompletedQuarters === 1 ? [10, 11, 12] : [(volumeCompletedQuarters - 1) * 3 - 2, (volumeCompletedQuarters - 1) * 3 - 1, (volumeCompletedQuarters - 1) * 3];
                const priorYear = volumeCompletedQuarters === 1 ? data.previousYear : data.currentYear;
                latestQuarterPrior = aggregateSrRows(data.monthly.filter(row => row.scope === 'TOTAL' && row.year === priorYear && priorMonths.includes(row.month)));
            }
            const quarterChange = latestQuarter ? changeValue(latestQuarter.sr_total, latestQuarterPrior.sr_total) : { text: '-', rate: tr('暂无完整季度', 'No completed quarter') };
            const focusKpis = '<div class="nc-sr-kpis">' + kpi(tr('本年累计 SR', 'Current YTD SRs'), current.sr_total.toLocaleString('zh-CN'), data.currentYear + '-01 ~ ' + data.currentYear + '-' + pad2(data.currentMonth), '') + kpi(tr('本年累计同比增减', 'Current YTD YoY Change'), annualChange.text, tr('相对上年同期 ', 'vs prior YTD ') + annualChange.rate, annualChange.delta > 0 ? 'warn' : annualChange.delta < 0 ? 'good' : '') + kpi(tr('最新完整季度 SR', 'Latest Completed Quarter'), latestQuarter ? latestQuarter.sr_total.toLocaleString('zh-CN') : '-', latestQuarter ? data.currentYear + ' Q' + volumeCompletedQuarters : tr('暂无完整季度', 'No completed quarter'), '') + kpi(tr('相对上季度环比增减', 'QoQ Change'), quarterChange.text, tr('环比 ', 'QoQ ') + quarterChange.rate, quarterChange.delta > 0 ? 'warn' : quarterChange.delta < 0 ? 'good' : '') + '</div>';
            const volumeComparisonRows = scopes.map(scope => { const full = summaryMap.get('previousFull|' + scope.key) || normalizeSrRow({}, {}); const prior = summaryMap.get('previousYtd|' + scope.key) || normalizeSrRow({}, {}); const now = summaryMap.get('currentYtd|' + scope.key) || normalizeSrRow({}, {}); return '<tr class="' + (scope.key === 'TOTAL' ? 'nc-total' : '') + '"><td class="nc-name">' + scope.label + '</td><td>' + full.sr_total + '</td><td>' + prior.sr_total + '</td><td>' + now.sr_total + '</td><td>' + renderVolumeChange(now.sr_total, prior.sr_total) + '</td></tr>'; }).join('');
            const volumeQuarterRows = []; const quarterLabels = []; const quarterPriorYearValues = []; const quarterCurrentValues = []; const quarterPriorValues = [];
            for (let quarter = 1; quarter <= volumeCompletedQuarters; quarter += 1) {
                const months = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
                const priorMonths = quarter === 1 ? [10, 11, 12] : [(quarter - 1) * 3 - 2, (quarter - 1) * 3 - 1, (quarter - 1) * 3];
                const priorQuarterYear = quarter === 1 ? data.previousYear : data.currentYear;
                const totalNow = aggregateSrRows(data.monthly.filter(row => row.scope === 'TOTAL' && row.year === data.currentYear && months.includes(row.month)));
                const totalPriorYearSame = aggregateSrRows(data.monthly.filter(row => row.scope === 'TOTAL' && row.year === data.previousYear && months.includes(row.month)));
                const totalPriorQuarter = aggregateSrRows(data.monthly.filter(row => row.scope === 'TOTAL' && row.year === priorQuarterYear && priorMonths.includes(row.month)));
                quarterLabels.push('Q' + quarter);
                quarterPriorYearValues.push(totalPriorYearSame.sr_total);
                quarterCurrentValues.push(totalNow.sr_total);
                quarterPriorValues.push(totalPriorQuarter.sr_total);
            }
            scopes.forEach(scope => {
                for (let quarter = 1; quarter <= volumeCompletedQuarters; quarter += 1) {
                    const months = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
                    const priorMonths = quarter === 1 ? [10, 11, 12] : [(quarter - 1) * 3 - 2, (quarter - 1) * 3 - 1, (quarter - 1) * 3];
                    const priorQuarterYear = quarter === 1 ? data.previousYear : data.currentYear;
                    const now = aggregateSrRows(data.monthly.filter(row => row.scope === scope.key && row.year === data.currentYear && months.includes(row.month)));
                    const priorYearSame = aggregateSrRows(data.monthly.filter(row => row.scope === scope.key && row.year === data.previousYear && months.includes(row.month)));
                    const priorQuarter = aggregateSrRows(data.monthly.filter(row => row.scope === scope.key && row.year === priorQuarterYear && priorMonths.includes(row.month)));
                    volumeQuarterRows.push(
                        '<tr class="' + (scope.key === 'TOTAL' ? 'nc-total' : '') + '">'
                        + '<td class="nc-name">' + scope.label + '</td>'
                        + '<td>Q' + quarter + '</td>'
                        + '<td>' + priorYearSame.sr_total + '</td>'
                        + '<td>' + now.sr_total + '</td>'
                        + '<td>' + renderVolumeChange(now.sr_total, priorYearSame.sr_total) + '</td>'
                        + '<td>' + priorQuarter.sr_total + '</td>'
                        + '<td>' + renderVolumeChange(now.sr_total, priorQuarter.sr_total) + '</td>'
                        + '</tr>'
                    );
                }
            });
            const monthMap = new Map(data.monthly.map(row => [(row.scope || 'TOTAL') + '|' + row.year + '|' + row.month, row]));
            const volumeMonthlyRows = [];
            for (let month = data.currentMonth; month >= 1; month -= 1) {
                for (const scope of scopes) {
                    const now = monthMap.get(scope.key + '|' + data.currentYear + '|' + month) || normalizeSrRow({}, {});
                    const prior = monthMap.get(scope.key + '|' + data.previousYear + '|' + month) || normalizeSrRow({}, {});
                    volumeMonthlyRows.push(
                        '<tr class="' + (scope.key === 'TOTAL' ? 'nc-total' : '') + '">'
                        + '<td class="nc-name">' + data.currentYear + '-' + pad2(month) + '</td>'
                        + '<td class="nc-name">' + scope.label + '</td>'
                        + '<td>' + prior.sr_total + '</td>'
                        + '<td>' + now.sr_total + '</td>'
                        + '<td>' + renderVolumeChange(now.sr_total, prior.sr_total) + '</td>'
                        + '<td>' + now.minor_sr_cnt + '</td>'
                        + '<td>' + now.major_sr_cnt + '</td>'
                        + '<td>' + now.critical_sr_cnt + '</td>'
                        + '<td>' + srPercent(now.sr_frt) + '</td>'
                        + '<td>' + now.unclose_sr_cnt + '</td>'
                        + '<td>' + now.overdue_sr_cnt + '</td>'
                        + '</tr>'
                    );
                }
            }
            const chartMonths = Array.from({ length: data.currentMonth }, (_, index) => index + 1); const monthLabels = chartMonths.map(pad2);
            const monthPriorValues = chartMonths.map(month => num((monthMap.get('TOTAL|' + data.previousYear + '|' + month) || {}).sr_total));
            const monthCurrentValues = chartMonths.map(month => num((monthMap.get('TOTAL|' + data.currentYear + '|' + month) || {}).sr_total));
            views.sr.innerHTML = srFilterHtml + '<div class="nc-card"><div class="nc-card-title"><span>' + tr('SR 数量变化总览', 'SR Volume Movement Overview') + '</span><small>' + tr('Technical Request · CNBG + EBG · 数据截至 ', 'Technical Request · CNBG + EBG · Through ') + data.currentYear + '-' + pad2(data.currentMonth) + '</small></div><div class="nc-sr-section-note">' + tr('主视图优先呈现 SR 数量同比与环比；正数表示增加，负数表示减少。仅使用完整季度计算环比。', 'The primary view prioritizes SR volume YoY and QoQ. Positive means an increase and negative means a decrease. QoQ uses completed quarters only.') + '</div></div>' + focusKpis
                + '<div class="nc-card"><div class="nc-card-title"><span>' + tr('年度 SR 数量同比', 'Annual SR Volume YoY') + '</span></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>' + data.previousYear + tr('全年', ' Full Year') + '</th><th>' + data.previousYear + tr('同期', ' YTD') + '</th><th>' + data.currentYear + tr('累计', ' YTD') + '</th><th>' + tr('同比增减量 / 增减率', 'YoY Change / Rate') + '</th></tr></thead><tbody>' + volumeComparisonRows + '</tbody></table></div></div>'
                + '<div class="nc-card"><div class="nc-card-title"><span>' + tr('季度 SR 数量同比 / 环比', 'Quarterly SR Volume YoY / QoQ') + '</span><small>' + tr('分 BG · 仅完整季度', 'By BG · Completed quarters only') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>' + tr('季度', 'Quarter') + '</th><th>' + tr('上年同期', 'Prior-year Quarter') + '</th><th>' + tr('本年', 'Current Year') + '</th><th>' + tr('同比增减', 'YoY Change') + '</th><th>' + tr('上季度', 'Previous Quarter') + '</th><th>' + tr('环比增减', 'QoQ Change') + '</th></tr></thead><tbody>' + (volumeQuarterRows.join('') || '<tr><td colspan="7" class="nc-muted">' + tr('暂无完整季度', 'No completed quarter') + '</td></tr>') + '</tbody></table></div></div>'
                + '<div class="nc-card"><div class="nc-card-title"><span>' + tr('月度 SR 数量详表', 'Monthly SR Volume Details') + '</span><small>' + tr('分 BG · 本年逐月与上年同月对比', 'By BG · Current months vs prior-year months') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('月份', 'Month') + '</th><th>' + tr('范围', 'Scope') + '</th><th>' + tr('上年同月', 'Prior-year Month') + '</th><th>' + tr('本月 SR', 'Current SR') + '</th><th>' + tr('同比增减量 / 增减率', 'YoY Change / Rate') + '</th><th>Minor</th><th>Major</th><th>Critical</th><th>FRT</th><th>' + tr('未关闭', 'Open') + '</th><th>' + tr('逾期', 'Overdue') + '</th></tr></thead><tbody>' + volumeMonthlyRows.join('') + '</tbody></table></div></div>'
                + severityHtml + '<div class="nc-card"><div class="nc-card-title"><span>' + tr('辅助质量与风险指标', 'Supporting Quality & Risk Metrics') + '</span><small>' + tr('弱化展示 · 本年累计', 'Secondary · Current YTD') + '</small></div><div class="nc-table-wrap"><table class="nc-table"><thead><tr><th>' + tr('范围', 'Scope') + '</th><th>FRT</th><th>' + tr('未关闭', 'Open') + '</th><th>' + tr('5日内到期', 'Due ≤5d') + '</th><th>' + tr('逾期未关闭', 'Overdue Open') + '</th><th>' + tr('逾期', 'Overdue') + '</th><th>' + tr('超过10天', '>10 Days') + '</th><th>' + tr('紧急恢复', 'Emergency') + '</th><th>' + tr('未恢复紧急', 'Unrecovered') + '</th><th>' + tr('解决时长', 'Resolution Time') + '</th><th>' + tr('授权率', 'Auth Rate') + '</th><th>' + tr('授权中过保率', 'Out-of-warranty') + '</th><th>' + tr('超长单', 'Overlong') + '</th><th>' + tr('非故障咨询', 'Non-fault') + '</th><th>' + tr('低分', 'Low Score') + '</th></tr></thead><tbody>' + scopes.map(scope => { const row = summaryMap.get('currentYtd|' + scope.key) || normalizeSrRow({}, {}); return '<tr class="' + (scope.key === 'TOTAL' ? 'nc-total' : '') + '"><td class="nc-name">' + scope.label + '</td><td>' + srPercent(row.sr_frt) + '</td><td>' + row.unclose_sr_cnt + '</td><td>' + row.due_within_5days_sr_cnt + '</td><td>' + row.overdue_unclose_sr_cnt + '</td><td>' + row.overdue_sr_cnt + '</td><td>' + row.over_10days_sr_cnt + '</td><td>' + row.emergency_recovery_cnt + '</td><td>' + row.unrecovered_emergency_cnt + '</td><td>' + row.e2e_report_to_resolve_dura.toFixed(2) + 'h</td><td>' + srPercent(row.authed_rate) + '</td><td>' + srPercent(row.auth_out_warranty_rate) + '</td><td>' + row.overlong_sr_cnt + '</td><td>' + row.non_fault_inquiry_sr_cnt + '</td><td>' + row.low_score_cnt + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
            const srCards = [...views.sr.querySelectorAll('.nc-card')];
            const annualChart = renderSrBarChart(tr('年度同期 SR 对比', 'Annual YTD SR Comparison'), scopes.map(scope => scope.label), [{ name: String(data.previousYear), color: '#64748b', values: scopes.map(scope => num((summaryMap.get('previousYtd|' + scope.key) || {}).sr_total)) }, { name: String(data.currentYear), color: '#38bdf8', values: scopes.map(scope => num((summaryMap.get('currentYtd|' + scope.key) || {}).sr_total)) }]);
            const quarterChart = renderSrBarChart(tr('季度同比与上季度对比', 'Quarter YoY & QoQ Comparison'), quarterLabels, [{ name: tr('上年同期', 'Prior year'), color: '#64748b', values: quarterPriorYearValues }, { name: tr('本年', 'Current'), color: '#38bdf8', values: quarterCurrentValues }, { name: tr('上季度', 'Prior quarter'), color: '#fbbf24', values: quarterPriorValues }]);
            const monthlyChart = renderSrLineChart(tr('月度 SR 趋势', 'Monthly SR Trend'), monthLabels, [{ name: String(data.previousYear), color: '#64748b', values: monthPriorValues }, { name: String(data.currentYear), color: '#38bdf8', values: monthCurrentValues }]);
            [[srCards[1], annualChart], [srCards[2], quarterChart], [srCards[3], monthlyChart]].forEach(entry => { const card = entry[0]; if (!card) return; const tableWrap = card.querySelector('.nc-table-wrap'); if (!tableWrap) return; const grid = document.createElement('div'); grid.className = 'nc-sr-analysis-grid'; tableWrap.parentNode.insertBefore(grid, tableWrap); grid.appendChild(tableWrap); grid.insertAdjacentHTML('beforeend', entry[1]); });
            const srAllButton = views.sr.querySelector('.nc-sr-type-all'); const srInputs = [...views.sr.querySelectorAll('[data-sr-type]')];
            const srProductLineAllButton = views.sr.querySelector('.nc-sr-product-line-all'); const srProductLineInputs = [...views.sr.querySelectorAll('[data-sr-product-line]')];
            function syncSrTypeDraft() { srTypeSelection = srInputs.filter(input => input.checked).map(input => input.dataset.srType); srAllButton.classList.toggle('active', !srTypeSelection.length); saveSrTypeSelection(); }
            function syncSrProductLineDraft() { srProductLineSelection = srProductLineInputs.filter(input => input.checked).map(input => input.dataset.srProductLine); srProductLineAllButton.classList.toggle('active', !srProductLineSelection.length); saveSrProductLineSelection(); }
            srInputs.forEach(input => input.addEventListener('change', syncSrTypeDraft)); srAllButton.addEventListener('click', () => { srInputs.forEach(input => { input.checked = false; }); syncSrTypeDraft(); });
            srProductLineInputs.forEach(input => input.addEventListener('change', syncSrProductLineDraft)); srProductLineAllButton.addEventListener('click', () => { srProductLineInputs.forEach(input => { input.checked = false; }); syncSrProductLineDraft(); });
            views.sr.querySelector('.nc-bu-apply').addEventListener('click', reloadSrData);
        }
        async function reloadSrData() {
            if (loading || changeLoading || srLoading || destroyed) return;
            if (simulationMode) { modeStatus.textContent = tr('模拟浮窗不访问正式接口，请导入 JSON 回顾历史数据。', 'Simulation does not call live APIs. Import JSON to review historical data.'); return; }
            const token = findCsrfToken(); if (!token) { modeStatus.textContent = tr('未找到 csrfToken，请刷新 NetCare 页面后重试。', 'csrfToken not found. Refresh the NetCare page and try again.'); return; }
            leaveReviewMode();
            srLoading = true; const applyButton = views.sr.querySelector('.nc-bu-apply'); if (applyButton) { applyButton.disabled = true; applyButton.textContent = tr('正在查询…', 'Querying…'); } modeStatus.textContent = tr('正在按所选 SR 类型和产品线获取数据…', 'Loading data for selected SR types and product lines…');
            try { const result = await loadSrData(token, srTypeSelection, srProductLineSelection); if (destroyed) return; if (dashboardCache) dashboardCache[5] = result; renderSr(result); modeStatus.textContent = dashboardCache ? dashboardStatus(dashboardCache) : tr('SR 数据已更新', 'SR data updated'); }
            catch (error) { modeStatus.textContent = tr('SR 筛选数据获取失败：', 'Failed to load filtered SR data: ') + (error && error.message || String(error)); console.error('[NetCare] Filtered SR request failed:', error); }
            finally { srLoading = false; const currentButton = views.sr.querySelector('.nc-bu-apply'); if (currentButton) { currentButton.disabled = false; currentButton.textContent = tr('按所选条件查询', 'Query Selected Filters'); } }
        }
        let cachedInterception = null;



        async function loadDashboard() {
            if (loading || changeLoading || srLoading || destroyed) return;
            if (simulationMode) { modeStatus.textContent = tr('模拟浮窗不访问正式接口，请点击“导入 JSON”离线回顾。', 'Simulation does not call live APIs. Import JSON for offline review.'); return; }
            const token = findCsrfToken();
            if (!token) { modeStatus.textContent = tr('未找到 csrfToken，请刷新 NetCare 页面后重试。', 'csrfToken not found. Refresh the NetCare page and try again.'); return; }
            leaveReviewMode();
            loading = true; refreshButton.disabled = true; jsonExportButton.disabled = true; modeStatus.textContent = tr('正在获取证书、EOS、变更数量、高危拦截及 SR 数据…', 'Loading certificates, EOS, change volume, high-risk interception, and SR data…');
            Object.values(views).forEach(view => { view.innerHTML = '<div class="nc-loading">' + tr('正在加载专题数据…', 'Loading insights…') + '</div>'; });
            try {
                const result = await Promise.all([
                    loadAllPages(tr('证书', 'Certificates'), API_URLS.certificate, SOURCE_PAGE.certificate, Object.assign({}, CERT_BODY, { limit: 50 }), token),
                    loadAllPages(tr('产品 EOS', 'Product EOS'), API_URLS.eos, SOURCE_PAGE.eos, PRODUCT_BODY, token),
                    loadAllPages(tr('版本 EOS', 'Version EOS'), API_URLS.eos, SOURCE_PAGE.eos, VERSION_BODY, token),
                    loadChangeData(token, changeBuSelection, changeProductLineSelection), loadInterceptionData(token), loadSrData(token, srTypeSelection, srProductLineSelection)
                ]);
                if (destroyed) return;
                dashboardCache = result; capturedAt = new Date().toISOString();
                renderCertificate(result[0]); renderEos(result[1], result[2]); renderChange(result[3]); cachedInterception = result[4]; renderInterception(cachedInterception); renderSr(result[5]);
                loaded = true;
                modeStatus.textContent = dashboardStatus(result);
            } catch (error) {
                const message = escapeHtml(error && error.message || String(error));
                Object.values(views).forEach(view => { view.innerHTML = '<div class="nc-error">' + tr('专题数据获取失败：', 'Failed to load insights: ') + message + '<br><br>' + tr('请确认 NetCare 登录状态后重试。', 'Confirm your NetCare session and try again.') + '</div>'; });
                modeStatus.textContent = tr('专题获取失败', 'Failed to load insights');
                console.error('[UIVF12 NetCare Analysis]', error);
            } finally { loading = false; refreshButton.disabled = false; jsonExportButton.disabled = !dashboardCache; }
        }
        refreshButton.addEventListener('click', loadDashboard);
        return {
            showCsv: function () { if (active) setMode(false); },
            isLoading: function () { return loading || changeLoading || srLoading; },
            destroy: function () { destroyed = true; document.body.classList.remove('nc-eos-fullscreen-open'); style.remove(); mode.remove(); button.remove(); }
        };
    }

    window.UIVNetCareAnalysis = {
        getRuntimeSource() { return `(${installNetCareAnalysisRuntime.toString()})`; },
        installForSimulation(root, options) { return installNetCareAnalysisRuntime(root, Object.assign({}, options, { simulation: true })); }
    };
})();
