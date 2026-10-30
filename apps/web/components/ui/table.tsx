// Source: https://ui.shadcn.com/r/styles/new-york-v4/table.json; local palette and metric adaptation.
"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
function Table({ className, ...props }: React.ComponentProps<"table">) {
    return (<div data-slot="table-container" className={cn("relative w-full overflow-x-auto")}>
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props}/>
    </div>);
}
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
    return (<thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props}/>);
}
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
    return (<tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props}/>);
}
function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
    return (<tfoot data-slot="table-footer" className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props}/>);
}
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
    return (<tr data-slot="table-row" className={cn("border-b border-solid border-[var(--line-soft)] transition-colors hover:bg-[#1c1c1e] data-[state=selected]:bg-muted", className)} {...props}/>);
}
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
    return (<th data-slot="table-head" className={cn("h-[40px] border-b border-solid border-[var(--line-soft)] px-[16px] py-[12px] text-left align-middle text-[12px] font-normal whitespace-nowrap text-muted-foreground first:w-auto first:pl-0 last:pr-0 last:text-right max-[760px]:px-[8px]", className)} {...props}/>);
}
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
    return (<td data-slot="table-cell" className={cn("h-[62px] border-b border-solid border-[var(--line-soft)] px-[16px] py-[12px] align-middle text-[12px] text-muted-foreground whitespace-nowrap first:pl-0 last:pr-0 last:text-right max-[760px]:h-[60px] max-[760px]:px-[8px]", className)} {...props}/>);
}
function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
    return (<caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props}/>);
}
export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption, };
