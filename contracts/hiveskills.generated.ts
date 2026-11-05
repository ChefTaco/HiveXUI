// Generated from HiveSkills OpenAPI 1.2.2; SHA256 8973cbbd339135f003901f5ff85bc8be020ad4582c505ce7c0e0370d8ee36cda.
// Apache-2.0. Source attribution: HiveSkills, extracted from Hive.
import {z} from 'zod';
export const AuditSchema=z.object({"action":z.string(),"actor":z.string(),"created_at":z.string(),"details":z.string(),"id":z.number(),"subject":z.string()});
export type Audit=z.infer<typeof AuditSchema>;
export const ChannelSchema=z.object({"channel":z.enum(["stable","canary"]),"skill_slug":z.string(),"version":z.string()});
export type Channel=z.infer<typeof ChannelSchema>;
export const CreateSkillSchema=z.object({"description":z.string(),"enabled":z.boolean().optional(),"homepage":z.union([z.string(),z.null()]).optional(),"name":z.string(),"slug":z.string()});
export type CreateSkill=z.infer<typeof CreateSkillSchema>;
export const DeploymentApprovalSchema=z.object({"publicationSha256":z.string().regex(new RegExp("^[a-f0-9]{64}$"))});
export type DeploymentApproval=z.infer<typeof DeploymentApprovalSchema>;
export const DeploymentCapabilitiesSchema=z.object({"enabled":z.boolean(),"executor":z.literal("magnus"),"message":z.string()});
export type DeploymentCapabilities=z.infer<typeof DeploymentCapabilitiesSchema>;
export const DeploymentJobSchema=z.object({"actor":z.string(),"created_at":z.string(),"id":z.string(),"result":z.union([z.string(),z.null()]),"status":z.enum(["awaiting_approval","queued","running","completed","failed","unknown"]),"target":z.string(),"updated_at":z.string()});
export type DeploymentJob=z.infer<typeof DeploymentJobSchema>;
export const EnrollTargetSchema=z.object({"channel":z.enum(["stable","canary"]),"skills":z.array(z.string()).optional()});
export type EnrollTarget=z.infer<typeof EnrollTargetSchema>;
export const ManagedDeploymentSchema=z.object({"actor":z.string(),"approval_expires_at":z.string(),"approved_at":z.union([z.string(),z.null()]),"created_at":z.string(),"id":z.string(),"magnus_job_id":z.union([z.string(),z.null()]),"manifest_json":z.string(),"publication_sha256":z.string().regex(new RegExp("^[a-f0-9]{64}$")),"result":z.union([z.string(),z.null()]),"status":z.enum(["awaiting_approval","queued","running","completed","failed","unknown"]),"target":z.string(),"updated_at":z.string()});
export type ManagedDeployment=z.infer<typeof ManagedDeploymentSchema>;
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
