import React from "react";
import { Wallet, AlertTriangle, Banknote, Receipt as ReceiptIcon } from "lucide-react";
import { formatMoney } from "../../utils/constants";
import { Card, StatCard, EmptyState } from "../../components/ui";
import { useData } from "../../context/DataContext";

function FinanceDashboard({ setPage, onOpenActivity }) {
  const data = useData();
  const { db } = data;
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
        <p className="text-sm text-slate-400 mt-0.5">Tilmaan Modern Academy — fees, payroll, and expenses at a glance.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="School Fee Collected" value={formatMoney(totalCollected)} icon={Wallet} tone="emerald" />
        <StatCard label="School Fee Outstanding" value={formatMoney(totalOutstanding)} icon={AlertTriangle} tone="amber" />
        <StatCard label="Payroll Net Pay" value={formatMoney(payrollNetPay)} icon={Banknote} tone="amber" />
        <StatCard label="Expenses This Month" value={formatMoney(expensesThisMonth)} icon={ReceiptIcon} tone="sky" />
      </div>
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Recent Financial Activity</h3>
        {db.activities.filter((a) => /payment|salary|expense|payroll/i.test(a.text)).length === 0 ? <EmptyState title="No financial activity yet" /> : (
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {db.activities.filter((a) => /payment|salary|expense|payroll/i.test(a.text)).slice(0, 10).map((a) => (
              a.navigation ? (
                <button key={a.id} type="button" onClick={() => onOpenActivity && onOpenActivity(a.navigation)} className="w-full flex gap-3 text-xs text-left hover:bg-slate-50 rounded-lg -mx-1 px-1 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                  <p className="text-slate-600 leading-snug hover:text-sky-700">{a.text}</p>
                </button>
              ) : (
                <div key={a.id} className="flex gap-3 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                  <p className="text-slate-600 leading-snug">{a.text}</p>
                </div>
              )
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export { FinanceDashboard };
