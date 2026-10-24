/* The image library is paged; AI suggestions and deletion confirmations share the same review card. */
(function(root){
    'use strict';
    const PAGE_SIZE=8;
    const displayed=item=>(item?.images||[]).slice(0,PAGE_SIZE);
    function create({API,t,find,render,aiStep,actions=()=>[]}){
        const active=new WeakMap();
        const gallery=record=>{const selected=active.get(record);return record.chat.includes(selected)?selected:[...record.chat].reverse().find(item=>item.kind==='gallery');};
        const pending=record=>[...record.chat].reverse().find(item=>item.kind==='image_delete'&&item.proposal?.status==='pending'&&Date.parse(item.proposal.expiresAt)>Date.now());
        async function fetchPage(record,item,number=1){
            const data=await API.get(`/api/ai-report/images?page=${Math.max(1,Number(number)||1)}&page_size=${PAGE_SIZE}`);
            item.images=data.items;item.gallery={page:data.page,pageSize:data.pageSize,total:data.total,totalPages:data.totalPages};
            item.text=t('历史图库：点击图片可在月报中预览；右下角的小垃圾桶用于删除。','Image library: click to preview; use the small trash icon to remove an image.');
            active.set(record,item);return item;
        }
        async function show(cellId,record,number=1){
            const item={role:'ai',kind:'gallery',text:'',images:[]};
            await fetchPage(record,item,number);record.chat.push(item);
        }
        function context(cellId){
            const record=find(cellId)?.cell;if(!record)return {};
            const item=gallery(record),proposal=pending(record);
            return {...(item?{gallery:{page:item.gallery?.page||1,ids:displayed(item).map(image=>image.id).filter(Boolean)}}:{}),
                ...(proposal?{pendingProposalId:proposal.proposal.id}:{})};
        }
        async function addProposal(record,reply){
            for(const entry of record.chat)if(entry.proposal?.status==='pending')entry.proposal.status='cancelled';
            const count=reply.images.length;
            record.chat.push({role:'ai',kind:'image_delete',text:t(`准备从历史图库移除这 ${count} 张图片。请核对下面的缩略图，再确认删除。已使用这些图片的月报及平台标识不受影响。`,`Review these ${count} images, then confirm their removal from the library. Existing reports and platform branding are unaffected.`),images:reply.images,
                proposal:{id:reply.proposalId,status:'pending',expiresAt:reply.expiresAt},reviewPage:1});
        }
        async function refreshGalleries(record){
            const pages=new Map();
            await Promise.all(record.chat.filter(item=>item.kind==='gallery').map(async item=>{
                const page=item.gallery?.page||1;
                if(!pages.has(page))pages.set(page,API.get(`/api/ai-report/images?page=${page}&page_size=${PAGE_SIZE}`));
                const data=await pages.get(page);
                item.images=data.items;item.gallery={page:data.page,pageSize:data.pageSize,total:data.total,totalPages:data.totalPages};
            }));
        }
        async function change(record,item,operation){
            const result=await API.post(`/api/ai-report/image-deletions/${encodeURIComponent(item.proposal.id)}/${operation}`,
                operation==='confirm'?{confirmed:true}:{});
            item.proposal.status=result.status;
            const text=operation==='confirm'?t(`已从历史图库移除 ${result.images.length} 张图片。现有月报及平台标识保持不变，可点“撤销删除”恢复。`,`Removed ${result.images.length} images from the library. Existing reports and platform branding are unchanged; Undo restores them.`):operation==='restore'?t('已撤销这次图库删除。','This library deletion was undone.'):t('已取消删除，没有移除图片。','Deletion cancelled; no images were removed.');
            // The note carries the usual next steps, so the conversation never ends without a way forward.
            record.chat.push({role:'ai',kind:'note',text,choices:actions(record)});
            if(operation!=='cancel')await refreshGalleries(record);
        }
        async function reply(cellId,record,result){
            if(result.type==='delete_confirmation'){await addProposal(record,result);return true;}
            if(result.type==='history_page'){
                const item=gallery(record),current=item?.gallery?.page||1;
                const number=result.page>0?result.page:current+(result.direction==='previous'?-1:1);
                if(item)await fetchPage(record,item,number);else await show(cellId,record,number);
                return true;
            }
            if(['confirm_delete','cancel_delete'].includes(result.type)){
                const item=record.chat.find(entry=>entry.kind==='image_delete'&&entry.proposal?.id===result.proposalId);
                if(!item)throw Error(t('请重新选择并核对删除清单。','Please select and review the images again.'));
                await change(record,item,result.type==='confirm_delete'?'confirm':'cancel');return true;
            }
            return false;
        }
        function page(cellId,index,number){
            const found=find(cellId),record=found?.cell,item=record?.chat[index];if(!item||found.busy)return;
            if(item.kind==='image_delete'){item.reviewPage=Math.max(1,Math.min(Math.ceil(item.images.length/PAGE_SIZE),number));render();return;}
            return aiStep(cellId,t('正在读取图片…','Loading images…'),()=>fetchPage(record,item,number));
        }
        function remove(cellId,index,id){
            const found=find(cellId),record=found?.cell,item=record?.chat[index];if(!item||found.busy)return;
            active.set(record,item);
            return aiStep(cellId,t('正在准备删除确认…','Preparing deletion review…'),async()=>{
                const result=await API.post('/api/ai-report/image-deletions',{ids:[id]});
                record.chat.push({role:'user',text:t(`删除图片：${item.images.find(image=>image.id===id)?.name||id}`,`Remove image: ${item.images.find(image=>image.id===id)?.name||id}`)});
                await addProposal(record,result);
            });
        }
        function decide(cellId,index,operation){
            const found=find(cellId),record=found?.cell,item=record?.chat[index];if(!item?.proposal||found.busy)return;
            return aiStep(cellId,t('正在更新图库…','Updating library…'),async()=>{
                record.chat.push({role:'user',text:operation==='confirm'?t(`确认删除清单中的 ${item.images.length} 张图片。`,`Confirm removal of these ${item.images.length} images.`):operation==='restore'?t('撤销这次删除。','Undo this deletion.'):t('取消删除。','Cancel deletion.')});
                await change(record,item,operation);
            });
        }
        function focus(cellId,index){const record=find(cellId)?.cell,item=record?.chat[index];if(item?.kind==='gallery')active.set(record,item);}
        return {show,context,reply,page,remove,decide,focus};
    }
    root.AiReportImageLibrary={create,displayed,PAGE_SIZE};
})(window);
