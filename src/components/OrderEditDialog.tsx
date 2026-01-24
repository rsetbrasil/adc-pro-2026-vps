import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
    User as UserIcon,
    ShoppingBag,
    CreditCard,
    Clock,
    MessageSquare,
    Save,
    Undo2,
    FileText,
    Calculator,
    Percent,
    Eye
} from 'lucide-react';
import type { Order, Installment, PaymentMethod } from '@/lib/types';
import { useAdmin } from '@/context/AdminContext';
import { useAuth } from '@/context/AuthContext';
import { useAudit } from '@/context/AuditContext';
import { useData } from '@/context/DataContext';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface OrderEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    order: Order | null;
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatBRL = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) {
        return "";
    }
    return value.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};

const getStatusVariant = (status: Order['status']): 'secondary' | 'default' | 'outline' | 'destructive' => {
    switch (status) {
        case 'Processando':
            return 'secondary';
        case 'Enviado':
            return 'default';
        case 'Entregue':
            return 'outline';
        case 'Cancelado':
        case 'Excluído':
            return 'destructive';
        default:
            return 'secondary';
    }
};

export function OrderEditDialog({ open, onOpenChange, order }: OrderEditDialogProps) {
    const { updateOrderStatus, updateOrderDetails } = useAdmin();
    const { user } = useAuth();
    const { toast } = useToast();
    const { products } = useData();
    const { logAction: auditLogAction } = useAudit(); // In case useAdmin doesn't expose it or needs it from AuditContext

    // Local state for editing
    const [installmentsInput, setInstallmentsInput] = useState(1);
    const [commissionInput, setCommissionInput] = useState('0,00');
    const [observationsInput, setObservationsInput] = useState('');
    const [discountInput, setDiscountInput] = useState(0);
    const [downPaymentInput, setDownPaymentInput] = useState(0);

    const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'gerente';

    useEffect(() => {
        if (order) {
            setInstallmentsInput(order.installments || 1);
            setCommissionInput(formatBRL(order.commission));
            setObservationsInput(order.observations || '');
            setDiscountInput(order.discount || 0);
            setDownPaymentInput(0); // Reset local input, actual value is in order.downPayment
        }
    }, [order]);

    const maxAllowedInstallments = useMemo(() => {
        if (!order || !products) return 10;
        const orderProductIds = order.items.map(item => item.id);
        const orderProducts = products.filter(p => orderProductIds.includes(p.id));
        if (orderProducts.length === 0) return 10;

        const maxInstallmentsArray = orderProducts.map(p => p.maxInstallments ?? 10);
        return Math.min(...maxInstallmentsArray);
    }, [order, products]);

    const handleUpdateOrderStatus = (status: Order['status']) => {
        if (order && user) {
            updateOrderStatus(order.id, status, auditLogAction, user);
        }
    };

    const handleUpdatePaymentMethod = (paymentMethod: PaymentMethod) => {
        if (!order || !user) return;
        updateOrderDetails(order.id, { paymentMethod }, auditLogAction, user);
    };

    const handleUpdateInstallments = () => {
        if (!order || !installmentsInput || !user) return;

        if (installmentsInput > maxAllowedInstallments) {
            toast({ title: "Limite de Parcelas Excedido", description: `O número máximo de parcelas para este pedido é ${maxAllowedInstallments}.`, variant: "destructive" });
            return;
        }

        updateOrderDetails(order.id, {
            installments: installmentsInput,
            discount: discountInput
        }, auditLogAction, user);
    };

    const handleCalculateCommission = () => {
        if (!order || !user) return;
        updateOrderDetails(order.id, { isCommissionManual: false }, auditLogAction, user);
        toast({ title: 'Comissão Recalculada!', description: `A comissão do pedido #${order.id} foi recalculada.` });
    };

    const handleUpdateCommission = () => {
        if (!order || !user) return;
        const value = parseFloat(commissionInput.replace(/\./g, '').replace(',', '.'));
        if (isNaN(value) || value < 0) {
            toast({ title: 'Valor inválido', description: 'Por favor, insira um valor de comissão válido.', variant: 'destructive' });
            return;
        }
        updateOrderDetails(order.id, { commission: value, isCommissionManual: true }, auditLogAction, user);
    };

    const handleUpdateDiscount = () => {
        if (!order || !user) return;
        const subtotal = order.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        if (isNaN(discountInput) || discountInput < 0 || discountInput > subtotal) {
            toast({ title: 'Desconto inválido', description: 'O valor do desconto não pode ser negativo ou maior que o subtotal do pedido.', variant: 'destructive' });
            return;
        }

        updateOrderDetails(order.id, { discount: discountInput }, auditLogAction, user);
    };

    const handleAddDownPayment = () => {
        if (!order || !user) return;
        if (isNaN(downPaymentInput) || downPaymentInput <= 0) {
            toast({ title: 'Valor inválido', description: 'Por favor, insira um valor de entrada válido.', variant: 'destructive' });
            return;
        }

        updateOrderDetails(order.id, { downPayment: downPaymentInput }, auditLogAction, user);
        setDownPaymentInput(0);
    };

    const handleResetDownPayment = () => {
        if (!order || !user) return;
        updateOrderDetails(order.id, { downPayment: 0, resetDownPayment: true }, auditLogAction, user);
    };

    const handleUpdateObservations = () => {
        if (!order || !user) return;
        updateOrderDetails(order.id, { observations: observationsInput }, auditLogAction, user);
        toast({ title: 'Observações Atualizadas', description: 'As observações foram salvas com sucesso.' });
    };

    if (!order) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Pedido: {order.id}</DialogTitle>
                    <DialogDescription>
                        Gerencie o status, faturamento e detalhes do pedido.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-grow overflow-y-auto p-1 pr-4 -mr-4 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader className="flex-row items-center gap-4 space-y-0 pb-4">
                                <UserIcon className="w-8 h-8 text-primary" />
                                <CardTitle className="text-lg">Cliente</CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm space-y-1">
                                <p><strong>Nome:</strong> {order.customer.name}</p>
                                <p><strong>CPF:</strong> {order.customer.cpf}</p>
                                <p><strong>Telefone:</strong> {order.customer.phone}</p>
                                <p><strong>Endereço:</strong> {`${order.customer.address}, ${order.customer.city}`}</p>
                                <Link href={`/admin/clientes?cpf=${order.customer.cpf}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-2')}>
                                    <Eye className='mr-2 h-4 w-4' /> Ver Cadastro Completo
                                </Link>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex-row items-center gap-4 space-y-0 pb-4">
                                <ShoppingBag className="w-8 h-8 text-primary" />
                                <CardTitle className="text-lg">Resumo da Compra</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2 text-sm">
                                    {order.items.map(item => (
                                        <div key={item.id} className="flex justify-between items-center">
                                            <span>{item.name} x {item.quantity}</span>
                                            <span>{formatCurrency(item.price * item.quantity)}</span>
                                        </div>
                                    ))}
                                    <Separator />
                                    {(order.downPayment || 0) > 0 && (
                                        <div className="flex justify-between items-center text-green-600">
                                            <span>Entrada</span>
                                            <span>- {formatCurrency(order.downPayment || 0)}</span>
                                        </div>
                                    )}
                                    {(order.discount || 0) > 0 && (
                                        <div className="flex justify-between items-center text-destructive">
                                            <span>Desconto</span>
                                            <span>- {formatCurrency(order.discount || 0)}</span>
                                        </div>
                                    )}
                                </div>
                                <Separator className="my-3" />
                                <div className="flex justify-between font-bold text-base">
                                    <span>TOTAL</span>
                                    <span>{formatCurrency(order.total)}</span>
                                </div>
                                <div className="flex justify-between text-sm mt-2">
                                    <span>Vendedor:</span>
                                    <span>{order.sellerName}</span>
                                </div>
                                <Separator className="my-3" />

                                {order.status === 'Entregue' && (
                                    <>
                                        <div className="flex justify-between text-base items-center">
                                            <span className="font-semibold text-green-600 flex items-center gap-2"><Percent className="h-4 w-4" />Comissão:</span>
                                            {isManagerOrAdmin ? (
                                                <div className="flex gap-2 items-center">
                                                    <span className="text-sm">R$</span>
                                                    <Input
                                                        type="text"
                                                        value={commissionInput}
                                                        onChange={(e) => setCommissionInput(e.target.value)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateCommission() }}
                                                        className="w-24 h-8 text-right"
                                                    />
                                                    <Button size="icon" variant="outline" onClick={handleCalculateCommission} className="h-8 w-8">
                                                        <Calculator className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="icon" variant="outline" onClick={handleUpdateCommission} className="h-8 w-8">
                                                        <Save className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <span className="font-bold text-green-600">{formatCurrency(order.commission || 0)}</span>
                                            )}
                                        </div>
                                        {order.isCommissionManual && <p className="text-xs text-muted-foreground text-right">Valor de comissão manual</p>}
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader className="flex-row items-center gap-4 space-y-0 pb-4">
                            <Clock className="w-8 h-8 text-primary" />
                            <CardTitle className="text-lg">Criação</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-1">
                            <div className="flex flex-col gap-1">
                                <p><span className="font-semibold">Criado por:</span> {order.createdByName || 'Sistema'}</p>
                                <p><span className="font-semibold">Origem:</span> {order.source === 'Online' ? '🌐 Catálogo Online' : '📝 Manual'}</p>
                                <p><span className="font-semibold">Data/Hora:</span> {format(parseISO(order.createdAt || order.date), "dd/MM/yyyy 'às' HH:mm")}</p>
                                <p><span className="font-semibold">IP:</span> {order.createdIp || '-'}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex-row items-center gap-4 space-y-0 pb-4">
                            <MessageSquare className="w-8 h-8 text-primary" />
                            <CardTitle className="text-lg">Observações do Pedido</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2">
                                <Textarea
                                    placeholder="Nenhuma observação registrada. Adicione uma aqui..."
                                    value={observationsInput}
                                    onChange={(e) => setObservationsInput(e.target.value)}
                                    rows={2}
                                />
                                <Button size="sm" variant="outline" onClick={handleUpdateObservations} className="self-end">
                                    <Save className="mr-2 h-4 w-4" /> Salvar
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex-row items-center gap-4 space-y-0 pb-4">
                            <CreditCard className="w-8 h-8 text-primary" />
                            <CardTitle className="text-lg">Faturamento e Status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                                <div>
                                    <label className="text-sm font-medium">Status do Pedido</label>
                                    <Select value={order.status} onValueChange={(status) => handleUpdateOrderStatus(status as Order['status'])}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Alterar status" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Processando">Processando</SelectItem>
                                            <SelectItem value="Enviado">Enviado</SelectItem>
                                            <SelectItem value="Entregue">Entregue</SelectItem>
                                            <SelectItem value="Cancelado">Cancelado</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Badge variant={getStatusVariant(order.status)} className="h-10 text-sm w-fit">{order.status}</Badge>
                            </div>
                            <Separator />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                                <div>
                                    <label className="text-sm font-medium">Desconto (R$)</label>
                                    <div className="flex gap-2">
                                        <Input
                                            inputMode="decimal"
                                            value={formatBRL(discountInput)}
                                            onChange={(e) => {
                                                const rawValue = e.target.value.replace(/\D/g, '');
                                                setDiscountInput(Number(rawValue) / 100);
                                            }}
                                            className="h-9"
                                        />
                                        <Button size="sm" variant="outline" onClick={handleUpdateDiscount}>
                                            <Save className="mr-2 h-4 w-4" /> Aplicar
                                        </Button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Entrada</label>
                                    {(order.downPayment || 0) > 0 ? (
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-muted px-3 py-2 text-sm">
                                                <span>{formatCurrency(order.downPayment || 0)}</span>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={handleResetDownPayment}>
                                                    <Undo2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Input
                                                inputMode="decimal"
                                                value={formatBRL(downPaymentInput)}
                                                onChange={(e) => {
                                                    const rawValue = e.target.value.replace(/\D/g, '');
                                                    setDownPaymentInput(Number(rawValue) / 100);
                                                }}
                                                className="h-9"
                                            />
                                            <Button size="sm" variant="outline" onClick={handleAddDownPayment}>
                                                <Save className="mr-2 h-4 w-4" /> Registrar
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Forma de Pagamento</label>
                                    <Select value={order.paymentMethod} onValueChange={(value) => handleUpdatePaymentMethod(value as PaymentMethod)}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Alterar forma de pagamento" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Crediário">Crediário</SelectItem>
                                            <SelectItem value="Pix">Pix</SelectItem>
                                            <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                                            <SelectItem value="Cartão Crédito">Cartão Crédito</SelectItem>
                                            <SelectItem value="Cartão Débito">Cartão Débito</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {order.paymentMethod === 'Crediário' && (
                                    <div>
                                        <label className="text-sm font-medium">Parcelas (Max: {maxAllowedInstallments})</label>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                value={installmentsInput}
                                                onChange={(e) => setInstallmentsInput(Number(e.target.value))}
                                                min="1" max={maxAllowedInstallments}
                                                className="w-24"
                                                onKeyDown={(e) => e.key === 'Enter' && handleUpdateInstallments()}
                                            />
                                            <Button size="sm" onClick={handleUpdateInstallments}>
                                                <Save className="mr-2 h-4 w-4" /> Salvar
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter className="pt-4 border-t">
                    {order.paymentMethod === 'Crediário' && (
                        <Button variant="secondary" asChild>
                            <Link href={`/carnet/${order.id}`} target="_blank" rel="noopener noreferrer">
                                <FileText className="mr-2 h-4 w-4" />
                                Ver Carnê Completo
                            </Link>
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
