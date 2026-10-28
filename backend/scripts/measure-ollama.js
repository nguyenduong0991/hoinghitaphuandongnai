const { performance } = require("node:perf_hooks");
(async () => {
 const base=(process.env.OLLAMA_URL||"http://127.0.0.1:11434").replace(/\/+$/,"");
 const model=process.env.OLLAMA_MODEL||"qwen3:4b-instruct";
 const prompts=["Trả lời đúng một từ: sẵn sàng.","Nêu một lợi ích của việc lập kế hoạch hội nghị, tối đa 8 từ.","Tóm tắt: hội nghị cần địa điểm, thời gian và người phụ trách. Tối đa 12 từ."];
 const ms=[],details=[];
 for(const prompt of prompts){
  const started=performance.now();
  const response=await fetch(base+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(90000),body:JSON.stringify({model,stream:false,think:false,keep_alive:"30m",messages:[{role:"user",content:prompt}],options:{temperature:0,num_ctx:1024,num_predict:24}})});
  if(!response.ok)throw Error("Ollama HTTP "+response.status);
  const data=await response.json(),wall=performance.now()-started;ms.push(wall);
  details.push({wall_ms:Math.round(wall),total_ms:Math.round((data.total_duration||0)/1e6),load_ms:Math.round((data.load_duration||0)/1e6),prompt_eval_ms:Math.round((data.prompt_eval_duration||0)/1e6),eval_ms:Math.round((data.eval_duration||0)/1e6),prompt_tokens:data.prompt_eval_count??null,output_tokens:data.eval_count??null});
 }
 const sorted=[...ms].sort((a,b)=>a-b),p95=Math.round(sorted[Math.ceil(.95*sorted.length)-1]);
 console.log(JSON.stringify({model,samples:details,average_wall_ms:Math.round(ms.reduce((a,b)=>a+b,0)/ms.length),p95_wall_ms:p95},null,2));
})().catch(error=>{console.error("Ollama measurement failed:",error.message);process.exitCode=1;});
