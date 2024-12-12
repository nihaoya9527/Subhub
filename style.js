export const styleCSS = `
/* 模板列表特定样式 */
.template-items {
    max-height: 200px;
    overflow-y: auto;
}

.template-item {
    cursor: pointer;
}

.template-item.selected {
    background-color: #e3f2fd !important;
}

/* 错误和加载状态样式 */
.error {
    color: #c62828;
    text-align: center;
    padding: 1rem;
}

.loading {
    text-align: center;
    color: #666;
    padding: 1rem;
}

.empty {
    color: #666;
    text-align: center;
    padding: 1rem;
}

/* 结果区域样式 */
.result {
    display: none;
}

/* 确保链接可以换行 */
.link-url {
    word-break: break-all;
}
`;