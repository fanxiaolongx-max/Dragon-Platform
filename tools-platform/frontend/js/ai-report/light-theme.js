/* AI reports use a fixed light palette without changing other pages' preferences. */
(function(){
 'use strict';
 if(new URLSearchParams(location.search).get('editorWindow')==='1')document.documentElement.classList.add('monthly-editor-window');
 const apply=node=>{if(node.dataset.theme!=='light')node.dataset.theme='light';if(node.classList.contains('dark-mode'))node.classList.remove('dark-mode');};
 const watch=node=>{apply(node);new MutationObserver(()=>apply(node)).observe(node,{attributes:true,attributeFilter:['data-theme','class']});};
 watch(document.documentElement);if(document.body)watch(document.body);else document.addEventListener('DOMContentLoaded',()=>watch(document.body),{once:true});
})();
