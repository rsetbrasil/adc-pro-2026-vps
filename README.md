# ADC PRO 2026 🚀

> **Sistema de Gestão Completo para Vendas e Crediário**

![Status](https://img.shields.io/badge/Status-Production-success)
![Version](https://img.shields.io/badge/Version-2.0.0-blue)
![License](https://img.shields.io/badge/License-Proprietary-red)

O **ADC PRO 2026** é uma plataforma robusta desenvolvida para gerenciar vendas, estoque, clientes e financeiro, com foco especial em operações de **Crediário**. O sistema conta com uma loja virtual (Catálogo) para os clientes e um Painel Administrativo completo para a gestão do negócio.

---

## 📚 Documentação de Implantação

Para deploy em produção (VPS Ubuntu + Nginx + Postgres), consulte o guia oficial:
👉 **[GUIA DE IMPLANTAÇÃO VPS](./DEPLOYMENT_GUIDE_VPS.md)**

---

## 🔥 Funcionalidades Principais

### 🛍️ Catálogo & Loja Virtual
*   **Catálogo Online**: Navegação fluida por produtos e categorias.
*   **Carrinho de Compras**: Gestão de itens e cálculo de total.
*   **Checkout Simplificado**: Cadastro rápido de cliente no ato da compra.
*   **Crediário Digital**: Sistema exclusivo de parcelamento e simulação de pagamentos.

### 🏢 Painel Administrativo
*   **Dashboard**: Visão geral de vendas, faturamento e alertas.
*   **Gestão de Pedidos**: Acompanhe status, pagamentos e entregas.
*   **Controle de Estoque**:
    *   Auditorias de Estoque (Balanço Mensal).
    *   Gestão de Avarias e Perdas.
    *   Histórico de Movimentações.
*   **Financeiro & Comissões**:
    *   Pagamento de Comissões para vendedores.
    *   Fluxo de Caixa e Relatórios.
*   **Gestão de Clientes**:
    *   Histórico de compras e pagamentos.
    *   Bloqueio e Restrições.
    *   Geração automática de Códigos de Cliente.

### ⚙️ Sistema
*   **Lixeira Inteligente**: Restauração de produtos/clientes excluídos acidentalmente.
*   **Logs de Auditoria**: Rastreamento de todas as ações importantes (quem fez o quê).
*   **Banco de Dados**: Migrado de NoSQL para **PostgreSQL** para máxima integridade.

---

## 🛠️ Tecnologias Utilizadas

Este projeto utiliza as tecnologias mais modernas do mercado para garantir performance e escalabilidade:

*   **Frontend**: [Next.js 15](https://nextjs.org/) (App Router) + React.
*   **Estilização**: [Tailwind CSS](https://tailwindcss.com/) + [Shadcn/UI](https://ui.shadcn.com/).
*   **Banco de Dados**: [PostgreSQL](https://www.postgresql.org/).
*   **ORM**: [Prisma](https://www.prisma.io/) (Tipagem segura e Migrations).
*   **Deploy**: PM2 + Nginx (Ubuntu VPS).

---

## 🚀 Como Rodar Localmente

1.  **Clone o projeto**
    ```bash
    git clone https://github.com/rsetbrasil/adc-pro-2026-vps.git
    cd adc-pro-2026-vps
    ```

2.  **Instale as dependências**
    ```bash
    npm install
    ```

3.  **Configure o Banco de Dados**
    *   Crie um banco PostgreSQL local.
    *   Renomeie `.env.example` para `.env` e configure a `DATABASE_URL`.

4.  **Rode as Migrations**
    ```bash
    npx prisma db push
    ```

5.  **Inicie o Servidor**
    ```bash
    npm run dev
    ```
    Acesse: `http://localhost:3000`

---

## 📞 Suporte

Desenvolvido e mantido por **rsetbrasil**.
📧 Contato: `rsetbrasil@gmail.com`

---
*© 2026 ADC Móveis e Eletros. Todos os direitos reservados.*
