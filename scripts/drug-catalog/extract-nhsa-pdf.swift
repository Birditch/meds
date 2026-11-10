// Reads the table out of 国家医保局's 《医保药品分类与代码数据库》 PDF, one JSON array of 19 cells per line.
//
// A plain text dump scrambles the multi-line cells, so this finds the real table: it renders each page,
// takes the ruled lines from the bitmap, and reads the text of each cell rectangle.
//
// macOS only (PDFKit). Usage: swift extract-nhsa-pdf.swift <pdf> <firstPage> <endPage> > rows.jsonl
import AppKit
import Foundation
import PDFKit

let columnCount = 19
let scale = 3
let inset: CGFloat = 0.4
let code = try! NSRegularExpression(pattern: "^[XZ][A-Z0-9]{15,28}$")

/// Centre of each run of `true`, in points measured from the low end of the axis.
func lines(_ hits: [Bool]) -> [CGFloat] {
  var out: [CGFloat] = []
  var i = 0
  while i < hits.count {
    if !hits[i] { i += 1; continue }
    var j = i
    while j + 1 < hits.count && hits[j + 1] { j += 1 }
    out.append(CGFloat(i + j + 1) / 2 / CGFloat(scale))
    i = j + 1
  }
  return out
}

/// Line wraps carry no meaning in Chinese cells, but foreign manufacturers need their word gaps.
func squeeze(_ raw: String) -> String {
  raw.replacingOccurrences(of: #"(?<=[A-Za-z.,&)])\s+(?=[A-Za-z(&])"#, with: "\u{E000}", options: .regularExpression)
    .components(separatedBy: .whitespacesAndNewlines).joined()
    .replacingOccurrences(of: "\u{E000}", with: " ")
}

func grid(of page: PDFPage) -> (xs: [CGFloat], ys: [CGFloat])? {
  let box = page.bounds(for: .mediaBox)
  let w = Int(box.width) * scale, h = Int(box.height) * scale
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
  ctx.setFillColor(gray: 1, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
  page.draw(with: .mediaBox, to: ctx)
  guard let data = ctx.data?.assumingMemoryBound(to: UInt8.self) else { return nil }

  var rowDark = [Int](repeating: 0, count: h)
  var colDark = [Int](repeating: 0, count: w)
  for y in 0..<h {
    for x in 0..<w where data[y * w + x] < 170 {
      rowDark[y] += 1
      colDark[x] += 1
    }
  }
  // Bitmap row 0 is the top of the page; reverse so y runs up, as PDF coordinates do.
  let ys = lines(rowDark.reversed().map { $0 > w / 2 })
  guard let bottom = ys.first, let top = ys.last, top > bottom else { return nil }
  let tall = Int((top - bottom) * CGFloat(scale))
  let xs = lines(colDark.map { $0 > tall * 6 / 10 })
  return (xs, ys)
}

func slot(_ v: CGFloat, _ edges: [CGFloat]) -> Int? {
  guard let first = edges.first, let last = edges.last, v > first, v < last else { return nil }
  var lo = 0, hi = edges.count - 1
  while hi - lo > 1 {
    let mid = (lo + hi) / 2
    if edges[mid] <= v { lo = mid } else { hi = mid }
  }
  return lo
}

let args = CommandLine.arguments
guard args.count == 4, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), let from = Int(args[2]), let to = Int(args[3]) else {
  FileHandle.standardError.write(Data("usage: <pdf> <firstPage> <endPage>\n".utf8))
  exit(2)
}

let stderr = FileHandle.standardError

for index in from..<min(to, doc.pageCount) {
  autoreleasepool {
    guard let page = doc.page(at: index), let g = grid(of: page) else {
      stderr.write(Data("page \(index): no grid\n".utf8))
      return
    }
    guard g.xs.count == columnCount + 1 else {
      stderr.write(Data("page \(index): \(g.xs.count - 1) columns\n".utf8))
      return
    }
    // Top row first, as read. Selections, because characterBounds(at:) does not index the same way as `string`.
    for row in (0..<(g.ys.count - 1)).reversed() {
      var out: [String] = []
      for c in 0..<columnCount {
        let rect = CGRect(x: g.xs[c] + inset, y: g.ys[row] + inset, width: g.xs[c + 1] - g.xs[c] - inset * 2, height: g.ys[row + 1] - g.ys[row] - inset * 2)
        let raw = page.selection(for: rect)?.string ?? ""
        out.append(squeeze(raw))
      }
      if out.allSatisfy(\.isEmpty) { continue }
      if code.firstMatch(in: out[0], range: NSRange(out[0].startIndex..., in: out[0])) == nil {
        // Only the first page carries the title and column headers.
        if index > 0 { stderr.write(Data("page \(index): bad code \(out[0]) | \(out[1])\n".utf8)) }
        continue
      }
      let json = try! JSONSerialization.data(withJSONObject: out, options: [.withoutEscapingSlashes])
      FileHandle.standardOutput.write(json)
      FileHandle.standardOutput.write(Data("\n".utf8))
    }
  }
}
