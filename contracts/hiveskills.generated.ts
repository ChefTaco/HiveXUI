// Generated from HiveSkills OpenAPI 1.2.2; SHA256 293f047b85bdf08d843d29397e9a70b27872ab432ae1c5f08c236861d655326c.
// Apache-2.0. Source attribution: HiveSkills, extracted from Hive.
import {z} from 'zod';
export const AuditSchema=z.object({"action":z.string(),"actor":z.string(),"created_at":z.string(),"details":z.string(),"id":z.number(),"subject":z.string()});
export type Audit=z.infer<typeof AuditSchema>;
export const ChannelSchema=z.object({"channel":z.enum(["stable","canary"]),"skill_slug":z.string(),"version":z.string()});
export type Channel=z.infer<typeof ChannelSchema>;
export const CreateSkillSchema=z.object({"description":z.string(),"enabled":z.boolean().optional(),"homepage":z.union([z.string(),z.null()]).optional(),"name":z.string(),"slug":z.string()});
export type CreateSkill=z.infer<typeof CreateSkillSchema>;
export const DeploymentJobSchema=z.object({"actor":z.string(),"created_at":z.string(),"id":z.string(),"result":z.union([z.string(),z.null()]),"status":z.enum(["queued","running","completed","failed"]),"target":z.string(),"updated_at":z.string()});
export type DeploymentJob=z.infer<typeof DeploymentJobSchema>;
export const EnrollTargetSchema=z.object({"channel":z.enum(["stable","canary"]),"skills":z.array(z.string()).optional()});
export type EnrollTarget=z.infer<typeof EnrollTargetSchema>;
export const ReceiptSchema=z.object({"channel":z.enum(["stable","canary"]),"receipt_json":z.union([z.string(),z.null()]),"skills_json":z.union([z.string(),z.null()]),"target":z.string(),"updated_at":z.string()});
export type Receipt=z.infer<typeof ReceiptSchema>;
export const ReleaseSchema=z.object({"createdAt":z.string(),"maxHermesVersion":z.union([z.string(),z.null()]).optional(),"minHermesVersion":z.union([z.string(),z.null()]).optional(),"notes":z.union([z.string(),z.null()]),"sha256":z.string().regex(new RegExp("^[a-f0-9]{64}$")),"skillSlug":z.string(),"version":z.string()});
export type Release=z.infer<typeof ReleaseSchema>;
export const SkillSchema=z.object({"createdAt":z.string(),"description":z.string(),"enabled":z.boolean(),"homepage":z.union([z.string(),z.null()]),"name":z.string(),"slug":z.string(),"updatedAt":z.string()});
export type Skill=z.infer<typeof SkillSchema>;
export const TargetSchema=z.object({"enabled":z.boolean(),"host":z.string(),"name":z.string(),"username":z.string()});
export type Target=z.infer<typeof TargetSchema>;
export const UploadReleaseSchema=z.object({"archiveBase64":z.string(),"maxHermesVersion":z.string().optional(),"minHermesVersion":z.string().optional(),"notes":z.string().optional(),"version":z.string()});
export type UploadRelease=z.infer<typeof UploadReleaseSchema>;
