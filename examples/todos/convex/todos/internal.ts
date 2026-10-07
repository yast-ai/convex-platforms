import { ConvexError,v } from 'convex/values';
import { paginationOptsValidator,paginationResultValidator } from 'convex/server';
import { internalMutation,internalQuery,identityFields } from '../platforms';
import schema from '../schema';
export const createTodo=internalMutation({
  platforms:true,args:{...identityFields,text:v.string()},returns:v.id('todos'),
  handler:async(ctx,{orgId,userId,text})=>{const value=text.trim();if(!value||value.length>200)throw new ConvexError({code:'invalid_text',status:400});return ctx.db.insert('todos',{orgId,userId,text:value});},
});
export const listTodos=internalQuery({
  platforms:true,args:{...identityFields,paginationOpts:paginationOptsValidator},returns:paginationResultValidator(schema.doc('todos')),
  handler:async(ctx,{orgId,paginationOpts})=>ctx.db.query('todos').withIndex('by_orgId',q=>q.eq('orgId',orgId)).paginate(paginationOpts),
});
export const deleteTodo=internalMutation({
  platforms:true,args:{...identityFields,id:v.id('todos')},returns:v.null(),
  handler:async(ctx,{orgId,userId,role,id})=>{const todo=await ctx.db.get('todos',id);if(!todo||todo.orgId!==orgId)throw new ConvexError({code:'not_found',status:404});if(todo.userId!==userId&&role!=='admin')throw new ConvexError({code:'forbidden',status:403});await ctx.db.delete('todos',id);return null;},
});
