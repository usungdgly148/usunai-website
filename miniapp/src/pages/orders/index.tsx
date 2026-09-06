import { RecordsPage } from '../../components/records-page';
import { useThemePage } from '../../hooks/use-theme-page';

export default function OrdersPage() {
  useThemePage();
  return <RecordsPage title='订单记录' subtitle='查看算力套餐购买与订单状态。' path='orders' kind='order' />;
}
