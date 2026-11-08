const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home-theme.css and desktop-agents.css ensure voice and send buttons stay docked on the right in external sessions', () => {
    const homeThemePath = path.join(__dirname, '../frontend/css/home-theme.css');
    const desktopAgentsCssPath = path.join(__dirname, '../frontend/css/desktop-agents.css');
    const homeTheme = fs.readFileSync(homeThemePath, 'utf8');
    const desktopAgents = fs.readFileSync(desktopAgentsCssPath, 'utf8');

    // Verify home-theme.css handles hidden enhance + hidden model, keeping voice/send docked right
    assert.match(
        homeTheme,
        /html\[data-ui="v2"\] #dcComposer #dcEnhance\[hidden\] ~ #dcModel\[hidden\] ~ #dcVoice:not\(\[hidden\]\)/,
        'home-theme.css should anchor #dcVoice to margin-left: auto when both #dcEnhance and #dcModel are hidden'
    );
    assert.match(
        homeTheme,
        /html\[data-ui="v2"\] body\.dc-external-compose #dcComposer #dcEnhance\[hidden\] ~ #dcModel\[hidden\] ~ #dcVoice:not\(\[hidden\]\)/,
        'home-theme.css should anchor #dcVoice to margin-left: auto in body.dc-external-compose when enhance and model are hidden'
    );

    // Verify desktop-agents.css also handles right-docking in body.dc-external-compose
    assert.match(
        desktopAgents,
        /body\.dc-external-compose #dcComposer #dcEnhance\[hidden\] ~ #dcModel\[hidden\] ~ #dcVoice/,
        'desktop-agents.css should anchor #dcVoice to margin-left: auto when enhance and model are hidden in external compose'
    );
    assert.match(
        desktopAgents,
        /body\.dc-external-compose #dcComposer #dcEnhance\[hidden\] ~ #dcModel\[hidden\] ~ #dcVoice\[hidden\] ~ #dcSend/,
        'desktop-agents.css should anchor #dcSend to margin-left: auto if enhance, model and voice are hidden'
    );
});

test('external composers retain native model choices while channel composers hide platform models', () => {
    const code=fs.readFileSync(path.join(__dirname,'../frontend/js/home/dragon-claw.js'),'utf8');
    const ast=require('../backend/node_modules/acorn').parse(code,{ecmaVersion:'latest'});
    const node=ast.body[0].expression.callee.body.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='setExternalComposer');
    const source=code.slice(node.start,node.end),vm=require('node:vm');
    for(const native of [false,true]){
        const el={model:{hidden:false},input:{disabled:false}},composer={canSend:true};
        vm.runInNewContext('('+source+')(composer)',{el,composer,external:{sending:false},document:{body:{classList:{toggle(){}}}},window:{HomeDesktopModels:{render:()=>native}},currentModel:()=>({id:'platform'}),localStorage:{getItem:()=> 'admin'},applyPlaceholder(){},updateSendButton(){}});
        assert.equal(el.model.hidden,!native);
        assert.equal(el.input.disabled,false);
    }
});
