import { RecordsPage } from '../../components/records-page';
import { useThemePage } from '../../hooks/use-theme-page';

export default function ComputePage() {
  useThemePage();
  return <RecordsPage title='算力记录' subtitle='查看充值与使用流水，数据与网站实时一致。' path='compute-records' kind='compute' />;
}
