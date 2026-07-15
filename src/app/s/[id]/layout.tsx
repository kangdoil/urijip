import { ProposalSnackbar } from '@/components/proposal-snackbar'

export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <>
      <ProposalSnackbar sessionId={id} />
      {children}
    </>
  )
}
