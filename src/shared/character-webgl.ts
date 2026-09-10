import type { Character, CharacterInstance, Point } from './character-schema';
import { evaluateCharacter, attachmentVertices } from './character-runtime';
import { worldMatrices } from './character-math';
const vertex=`attribute vec2 position;attribute vec2 uv;uniform vec2 size;varying vec2 texcoord;void main(){texcoord=uv;gl_Position=vec4(position.x/size.x*2.-1.,1.-position.y/size.y*2.,0.,1.);}`;
const fragment=`precision mediump float;varying vec2 texcoord;uniform sampler2D image;uniform float opacity;uniform float solid;void main(){vec4 c=mix(texture2D(image,texcoord),vec4(1.),solid);gl_FragColor=vec4(c.rgb*c.a,c.a)*opacity;}`;
/** A small textured-triangle renderer. No project code or shaders are executable inputs. */
export class CharacterWebGL {
  private gl:WebGLRenderingContext;
  private program:WebGLProgram;
  private buffer:WebGLBuffer;
  private textures=new Map<string,{source:TexImageSource;texture:WebGLTexture}>();
  constructor(canvas:HTMLCanvasElement) {
    const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,stencil:true,preserveDrawingBuffer:true});if(!gl)throw new Error('WebGL unavailable');this.gl=gl;
    const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Character shader compilation failed');return s;};
    const v=shader(gl.VERTEX_SHADER,vertex),f=shader(gl.FRAGMENT_SHADER,fragment),p=gl.createProgram()!;gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Character shader linking failed');this.program=p;this.buffer=gl.createBuffer()!;
  }
  dispose(){const g=this.gl;this.textures.forEach(t=>g.deleteTexture(t.texture));this.textures.clear();g.deleteBuffer(this.buffer);g.deleteProgram(this.program);g.getExtension('WEBGL_lose_context')?.loseContext();}
  private draw(vertices:Point[],uv:Point[],indices:number[],solid=false) {
    const g=this.gl,data=new Float32Array(indices.length*4);indices.forEach((index,i)=>{data.set([...vertices[index],...(uv[index]??[0,0])],i*4);});
    g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferData(g.ARRAY_BUFFER,data,g.DYNAMIC_DRAW);
    for(const [name,offset] of [['position',0],['uv',8]] as const){const location=g.getAttribLocation(this.program,name);g.enableVertexAttribArray(location);g.vertexAttribPointer(location,2,g.FLOAT,false,16,offset);}
    g.uniform1f(g.getUniformLocation(this.program,'solid'),solid?1:0);g.drawArrays(g.TRIANGLES,0,indices.length);
  }
  render(c:Character,i:CharacterInstance,images:Map<string,TexImageSource>,time:number) {
    const g=this.gl;if(g.isContextLost())throw new Error('Character graphics context lost');
    g.viewport(0,0,g.canvas.width,g.canvas.height);g.useProgram(this.program);g.uniform2f(g.getUniformLocation(this.program,'size'),c.width,c.height);g.clearColor(0,0,0,0);g.stencilMask(255);g.clear(g.COLOR_BUFFER_BIT|g.STENCIL_BUFFER_BIT);g.enable(g.BLEND);g.disable(g.DEPTH_TEST);
    const pose=evaluateCharacter(c,i,time),world=worldMatrices(c.bones,pose.bones),slots=[...c.slots].sort((a,b)=>pose.slots[a.id].order-pose.slots[b.id].order);
    const clips:{points:Point[];inverse:boolean;end:string}[]=[];
    const live=new Set<string>();
    for(const slot of slots) {
      const state=pose.slots[slot.id],a=c.attachments.find(a=>a.id===state.attachment);
      if(a&&a.kind!=='bounds') {
        const vertices=attachmentVertices(c,a,pose,world);
        if(a.kind==='clipping') clips.push({points:vertices,inverse:a.inverse??false,end:a.clipEndSlotId??slots.at(-1)!.id});
        else {
          const assetId=a.kind==='sequence'?a.frames?.[Math.floor(time*(a.fps??12))%a.frames.length]:a.assetId,source=images.get(assetId??'');
          if(source&&assetId) {
            live.add(assetId);let texture=this.textures.get(assetId);
            if(!texture||texture.source!==source){if(texture)g.deleteTexture(texture.texture);texture={source,texture:g.createTexture()!};this.textures.set(assetId,texture);g.bindTexture(g.TEXTURE_2D,texture.texture);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,source);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);}else g.bindTexture(g.TEXTURE_2D,texture.texture);
            g.disable(g.STENCIL_TEST);
            if(clips.length) {
              g.enable(g.STENCIL_TEST);g.stencilMask(255);g.clear(g.STENCIL_BUFFER_BIT);g.colorMask(false,false,false,false);
              // Toggle a stencil bit per polygon triangle fan. Even-odd supports concave polygons.
              clips.forEach((clip,index)=>{
                const bit=1<<index;g.stencilMask(bit);g.stencilFunc(g.ALWAYS,0,255);g.stencilOp(g.KEEP,g.KEEP,g.INVERT);
                if(clip.inverse)this.draw([[0,0],[c.width,0],[c.width,c.height],[0,c.height]],[],[0,1,2,0,2,3],true);
                this.draw(clip.points,[],Array.from({length:clip.points.length-2},(_,n)=>[0,n+1,n+2]).flat(),true);
              });
              g.colorMask(true,true,true,true);g.stencilMask(0);const mask=(1<<clips.length)-1;g.stencilFunc(g.EQUAL,mask,mask);g.stencilOp(g.KEEP,g.KEEP,g.KEEP);
            }
            g.blendFunc(slot.blend==='multiply'?g.DST_COLOR:g.ONE,slot.blend==='add'?g.ONE:slot.blend==='screen'?g.ONE_MINUS_SRC_COLOR:g.ONE_MINUS_SRC_ALPHA);
            g.uniform1f(g.getUniformLocation(this.program,'opacity'),Math.max(0,Math.min(1,state.opacity)));
            const mesh=a.mesh??c.attachments.find(x=>x.id===a.sourceMeshId)?.mesh;
            this.draw(vertices,mesh?.uv??[[0,0],[1,0],[1,1],[0,1]],mesh?.triangles??[0,1,2,0,2,3]);
          }
        }
      }
      for(let n=clips.length-1;n>=0;n--)if(clips[n].end===slot.id)clips.splice(n,1);
    }
    g.disable(g.STENCIL_TEST);for(const [id,t] of this.textures)if(!images.has(id)){g.deleteTexture(t.texture);this.textures.delete(id);}
  }
}
