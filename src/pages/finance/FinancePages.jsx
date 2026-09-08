import React from "react";
import { Wallet, AlertTriangle, Banknote, Receipt as ReceiptIcon } from "lucide-react";
import { formatMoney } from "../../utils/constants";
import { Card, StatCard } from "../../components/ui";
import { RecentActivityFeed } from "../../components/RecentActivity";
import { useData } from "../../context/DataContext";

// A financial activity: mentions money movement in its text, or deep-links to a finance page.
const FINANCIAL_ACTIVITY_RE = /payment|salary|expense|payroll|fee|receipt|advance|void|reminder/i;
function isFinancialActivity(a) {
  return FINANCIAL_ACTIVITY_RE.test(a.text || "")
    || ["payments", "payroll", "expenses"].includes(a.navigation?.page);
}

function FinanceDashboard({ setPage, onOpenActivity }) {
  const data = useData();
  const { db } = data;
  const financialActivities = db.activities.filter(isFinancialActivity);
  const activeStudents = db.students.filter((s) => s.status !== "WITHDRAWN" && s.status !== "TRANSFERRED" && s.status !== "GRADUATED" && s.status !== "ARCHIVED");
  const totalCollected = db.payments.filter((p) => p.status !== "VOIDED").reduce((sum, p) => sum + p.amountTotal, 0);
  const totalOutstanding = activeStudents.reduce((sum, s) => sum + data.studentPaymentSummary(s).totalOwed, 0);
  const payrollNetPay = db.staff.reduce((sum, s) => sum + (data.staffSalarySummary(s.id)?.outstanding || 0), 0);
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const expensesThisMonth = db.expenses.filter((e) => e.date?.slice(0, 7) === thisMonthKey).reduce((sum, e) => sum + e.totalAmount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Finance & Operations</h1>
        <p className="text-sm text-slate-400 mt-0.5">Hiil Model School — fees, payroll, and expenses at a glance.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="School Fee Collected" value={formatMoney(totalCollected)} icon={Wallet} tone="emerald" />
        <StatCard label="School Fee Outstanding" value={formatMoney(totalOutstanding)} icon={AlertTriangle} tone="amber" />
        <StatCard label="Payroll Net Pay" value={formatMoney(payrollNetPay)} icon={Banknote} tone="amber" />
        <StatCard label="Expenses This Month" value={formatMoney(expensesThisMonth)} icon={ReceiptIcon} tone="sky" />
      </div>
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Recent Financial Activity</h3>
        <RecentActivityFeed activities={financialActivities} onOpenActivity={onOpenActivity} maxHeight="max-h-72" />
      </Card>
    </div>
  );
}

export { FinanceDashboard };
