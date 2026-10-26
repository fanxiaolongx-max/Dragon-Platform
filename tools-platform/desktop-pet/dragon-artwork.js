/* Transparent fallback artwork and generic alpha-bound utilities. */
(function (host) {
  'use strict';
  function bounds(pixels, width, height) {
    var count=width*height, seen=new Uint8Array(count), queue=new Uint32Array(count);
    var largest=0, box=null;
    // Measure the largest connected opaque figure, excluding neighbouring hands and specks.
    for(var start=0;start<count;start++) {
      if(seen[start] || pixels[start*4+3]<=128)continue;
      var head=0,tail=1,left=width,right=0,top=height,bottom=0;
      queue[0]=start;seen[start]=1;
      while(head<tail) {
        var at=queue[head++],x=at%width,y=Math.floor(at/width);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        var neighbours=[x>0?at-1:-1,x+1<width?at+1:-1,y>0?at-width:-1,y+1<height?at+width:-1];
        for(var n=0;n<4;n++) {
          var next=neighbours[n];
          if(next>=0&&!seen[next]&&pixels[next*4+3]>128){seen[next]=1;queue[tail++]=next;}
        }
      }
      if(tail>largest){largest=tail;box={x:left,y:top,width:right-left+1,height:bottom-top+1};}
    }
    return largest<16?null:box;
  }

  function layout(box) {
    var scale=Math.min(600/box.height,360/box.width);
    return {scale:scale,x:(400-box.width*scale)/2,y:680-box.height*scale};
  }
  function order(kind) {
    // Out, pause, then retrace the same frames; never wrap the last head pose to the first.
    if(kind==='left'||kind==='right')return [0,1,2,2,1,0];
    return [0,1,2,3,4,5];
  }
  async function load(register) {
    var result={};
    await Promise.all(['idle','wave','walk','states'].map(async function(name){
      try {
        var image=await new Promise(function(resolve,reject){var img=new Image();img.onload=function(){resolve(img);};img.onerror=reject;img.src='./assets/dragon/'+name+'-atlas.png';});
        var w=image.naturalWidth/4,h=image.naturalHeight/2,scale=Math.min(520/(h*.94),360/(w*.92));
        result[name]=[];
        for(var i=0;i<8;i++) {
          var crop=document.createElement('canvas');crop.width=w;crop.height=h;
          var ctx=crop.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,(i%4)*w,Math.floor(i/4)*h,w,h,0,0,w,h);
          var box=bounds(ctx.getImageData(0,0,w,h).data,w,h);if(!box)throw new Error('Empty Dragon frame');
          // Uniform scale and fixed cell center preserve body size through a wave.
          // Only the baseline is aligned; do not enlarge a seated or airborne pose.
          var canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;
          var x=(400-w*scale)/2,y=560-(box.y+box.height)*scale;
          canvas.getContext('2d').drawImage(crop,x,y,w*scale,h*scale);
          var src=canvas.toDataURL('image/png');
          var eyes=name==='idle'&&i===0?[[.39,.22,.07,.06],[.58,.22,.07,.06]]:[];
          register(src,{side:false,closed:!eyes.length,eyes:eyes.map(function(e){return [(x+e[0]*w*scale)/400,(y+e[1]*h*scale)/600,e[2]*w*scale/400,e[3]*h*scale/600];})});
          result[name].push(src);
        }
      } catch (_) { /* The static 2D character remains usable if one atlas fails. */ }
    }));
    var idle=result.idle||[];
    result.front=idle.length?[idle[0]]:[];
    result.blink=idle.length?[idle[0],idle[1],idle[2],idle[2],idle[3],idle[0]]:[];
    result.left=idle.length?[idle[0],idle[4],idle[7]]:[];
    result.right=idle.length?[idle[0],idle[5],idle[6]]:[];
    result.directions=idle.length?[idle[6],idle[6],idle[1],idle[4]]:[];
    return result;
  }
  var api={load:load,bounds:bounds,layout:layout,order:order};
  if(host)host.DragonArtwork=api;else if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:null);
