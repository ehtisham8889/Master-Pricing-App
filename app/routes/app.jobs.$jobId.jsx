import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import prisma from "../db.server.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const job = await prisma.vipPriceJob.findUnique({
    where: { id: params.jobId },
  });
  if (!job || job.shop !== session.shop) {
    return json({ job: null }, { status: 404 });
  }
  return json({
    job: {
      id: job.id,
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      successCount: job.successCount,
      failureCount: job.failureCount,
      deletedCount: job.deletedCount,
      errorMessage: job.errorMessage,
      failures: JSON.parse(job.failures || "[]"),
      createdAt: job.createdAt.toISOString(),
    },
  });
};
