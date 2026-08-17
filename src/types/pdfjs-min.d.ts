/**
 * pdfjs-dist 的 legacy min 构建(pdf.min.mjs)不随包发布 .d.mts 声明文件，
 * 这里把它的类型对齐到包入口(types/src/pdf.d.ts)，供动态 import 做类型推导。
 */
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist'
}
