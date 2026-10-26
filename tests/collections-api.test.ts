import { beforeEach, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { POST, GET } from "@/app/api/collections/route";
import { GET as snapshot } from "@/app/api/places/route";
import { validCollectionCommand } from "@/lib/collections";
const cid="33333333-3333-4333-8333-333333333333", pid="22222222-2222-4222-8222-222222222222", op="44444444-4444-4444-8444-444444444444";
const command={action:"create",id:cid,name:"부산",description:"",color:"red",icon:"map"};
function req(body: unknown={operation_id:op,command}, origin="http://localhost", cookie=true) { return new Request("http://localhost/api/collections",{method:"POST",headers:{origin,"Content-Type":"application/json",...(cookie?{cookie:`datemap_session=${"a".repeat(64)}`}:{})},body:JSON.stringify(body)}); }
function get(url: string) { return new Request(`http://localhost${url}`,{headers:{cookie:`datemap_session=${"a".repeat(64)}`}}); }
beforeEach(()=>{vi.restoreAllMocks();reset();tables.boards=[{id:"b1",name:"지도",member_names:["우리","서로"],auth_version:1}];tables.access_sessions=[{token_hash:tokenHash("a".repeat(64)),board_id:"b1",purpose:"member",member_name:"우리",auth_version:1,expires_at:"2030-01-01"}];});
it("requires authentication, same origin and a valid identity before any write",async()=>{
 const rpc=vi.spyOn(fakeDb,"rpc");
 expect((await POST(req(undefined,"http://localhost",false))).status).toBe(401);
 expect((await POST(req(undefined,"https://foreign.example"))).status).toBe(403);
 tables.access_sessions[0].member_name="";expect((await POST(req())).status).toBe(409);expect(rpc).not.toHaveBeenCalled();
});
it("rejects oversized and malformed selection, uses the authenticated board and maps conflicts",async()=>{
 const rpc=vi.spyOn(fakeDb,"rpc").mockResolvedValue({data:{code:"COLLECTION_CONFLICT"},error:null});
 expect((await POST(req({operation_id:op,command:{...command,name:" "}}))).status).toBe(400);
 expect((await POST(req({operation_id:op,command:{action:"add",place_ids:[pid,pid],collection_ids:[cid]}}))).status).toBe(400);
 expect((await POST(req())).status).toBe(409);
 expect(rpc).toHaveBeenCalledWith("dm_change_collection",{p_board:"b1",p_who:"우리",p_operation:op,p_command:command});
});
it("a replay receipt is only readable within the current board",async()=>{
 tables.collection_operations=[{id:op,board_id:"b2",result:{ok:true,private:"secret"}}];
 expect(await (await GET(get(`/api/collections?operation=${op}`))).json()).toEqual({result:null});
 tables.collection_operations[0].board_id="b1";
 expect(await (await GET(get(`/api/collections?operation=${op}`))).json()).toHaveProperty("result.ok",true);
});
it("snapshot includes only own collections and active memberships",async()=>{
 tables.places=[{id:pid,board_id:"b1",name:"카페"},{id:"trash",board_id:"b1",deleted_at:"2026-10-27"}];
 tables.collections=[{id:cid,board_id:"b1",name:"우리 모음"},{id:"other",board_id:"b2",name:"비공개"}];
 tables.collection_places=[{board_id:"b1",collection_id:cid,place_id:pid},{board_id:"b1",collection_id:cid,place_id:"trash"},{board_id:"b2",collection_id:"other",place_id:pid}];
 const data=await (await snapshot(get("/api/places"))).json();
 expect(data.collections).toHaveLength(1);expect(data.collections[0]).toMatchObject({id:cid,place_ids:[pid]});
});
it("wire validation constrains cover values and operation bounds",()=>{
 expect(validCollectionCommand(command)).toBe(true);
 expect(validCollectionCommand({...command,icon:"script"})).toBe(false);
 expect(validCollectionCommand({...command,name:"a".repeat(41)})).toBe(false);
 expect(validCollectionCommand({action:"delete",id:cid,version:0})).toBe(false);
 expect(validCollectionCommand({action:"remove",collection_ids:[cid],place_ids:[]})).toBe(false);
});

it("reads beyond PostgREST's 1000-row cap without silently dropping memberships",async()=>{
 const { collectionMemberships }=await import("@/lib/collections-server");
 tables.collection_places=Array.from({length:1003},(_,i)=>({id:String(i).padStart(5,"0"),board_id:"b1",collection_id:cid,place_id:String(i)}));
 const result=await collectionMemberships("b1");expect(result.data).toHaveLength(1003);expect(result.error).toBeNull();
});
it("an uncertain database response is recoverable rather than a false save failure",async()=>{
 vi.spyOn(fakeDb,"rpc").mockResolvedValue({data:null,error:{message:"private upstream error"}});
 const response=await POST(req());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"COLLECTION_UNCONFIRMED"});
});
