# Cài Grok Imagine cho Codex, Claude và Hermes

Plugin không kèm tài khoản hay hạn mức của nhà phát triển. Mỗi người dùng tự đăng nhập tài khoản Grok của mình qua Grok CLI OAuth; ảnh và video đầu ra được lưu trên máy của họ.

## 1. Chuẩn bị

Cài Node.js 20 trở lên và Grok CLI chính thức. Sau đó kết nối tài khoản:

```bash
grok login --oauth
```

Đây là phương thức xác thực duy nhất của plugin. Không gửi access token, refresh token hoặc file `~/.grok/auth.json` cho bất kỳ ai.

## 2. Cài plugin

### Hermes — một lệnh từ GitHub

```bash
hermes plugins install quynhchiv/grok-imagine-codex --enable
```

Sau khi được duyệt vào catalog chính thức của Hermes, người dùng có thể cài bằng tên ngắn:

```bash
hermes plugins install grok-imagine --enable
```

Lưu ý CLI chính thức dùng `plugins` (số nhiều), không phải `plugin`.

### Codex

```bash
codex plugin marketplace add quynhchiv/grok-imagine-codex --ref v0.3.0
codex plugin add grok-imagine@grok-imagine
```

### Claude Code

```bash
claude plugin marketplace add quynhchiv/grok-imagine-codex
claude plugin install grok-imagine@grok-imagine
```

Khởi động lại agent và tạo task mới sau khi cài.

## 3. Chạy hướng dẫn tự động

Nhập:

```text
Setup Grok Imagine
```

Plugin kiểm tra Node.js, agent host, Grok CLI, OAuth, quyền truy cập model và thư mục lưu. Quá trình doctor không tạo ảnh/video và không dùng lượt media.

Nếu chưa đăng nhập, công cụ có thể mở luồng OAuth. Trên máy headless/SSH có thể dùng device-code. Sau khi đăng nhập, nhập `Check Grok Imagine setup`; thiết lập hoàn tất khi doctor báo `READY`.

## 4. Tạo ảnh/video đầu tiên

Tạo media có thể dùng hạn mức hoặc phát sinh chi phí trên tài khoản Grok của người dùng. Sau khi đã kiểm tra quyền model và chi phí, thử:

```text
Tạo một ảnh thử 1:1 chất lượng thấp: cáo origami màu đỏ trên nền trắng.
```

File mặc định nằm trong thư mục `grok-imagine-output` của người dùng. Có thể đặt `GROK_IMAGINE_OUT` thành một đường dẫn tuyệt đối khác.

## Khi cần hỗ trợ

Gửi kết quả của `Check Grok Imagine setup` và xóa thông tin cá nhân nếu cần. Không bao giờ gửi access token, refresh token hoặc file `~/.grok/auth.json`.
