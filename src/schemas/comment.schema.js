import { z } from "zod";

export const CommentSchema = z.object({
    date: z.string().optional(),
    time: z.string().optional(),
    author: z.string().optional(),
    text: z.string().min(1, "Comment text cannot be empty"),
    wfid: z.string().optional()
});

export const AttachmentManifestItemSchema = z.object({
    fileName: z.string().optional(),
    name: z.string().optional(),
    docType: z.string().optional(),
    type: z.string().optional(),
    uploadDate: z.string().optional(),
    attachedBy: z.string().optional(),
    attachedDate: z.string().optional(),
    attachedTime: z.string().optional(),
    timestamp: z.number().optional(),
    url: z.string().optional(),
    isTxt: z.boolean().optional(),
    size: z.number().optional()
}).refine(item => (typeof item.fileName === "string" && item.fileName.trim().length > 0) || (typeof item.name === "string" && item.name.trim().length > 0), {
    message: "Each attachment item must have a valid fileName or name"
});

export const OrderInputSchema = z.object({
    orderNumber: z.string().min(1, "orderNumber is required"),
    borrower: z.string().optional(),
    location: z.string().optional(),
    county: z.string().optional(),
    parcelId: z.string().optional(),
    comments: z.array(CommentSchema).min(1, "comments array must contain at least one comment"),
    availableAttachments: z.array(AttachmentManifestItemSchema).optional()
});
