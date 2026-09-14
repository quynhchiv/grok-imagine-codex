# Cài đặt Grok Imagine cho Codex

Hướng dẫn này dành cho người dùng không cần sửa mã nguồn. Plugin không kèm tài khoản, API key hoặc hạn mức của nhà phát triển; mỗi người sử dụng tài khoản xAI của chính mình.

## 1. Cài plugin

Mở terminal và chạy ba lệnh:

```powershell
codex plugin marketplace add quynhchiv/grok-imagine-codex --ref v0.2.1
codex plugin add grok-imagine@grok-imagine
codex plugin list
```

Đóng và mở lại Codex, sau đó tạo task mới. Khi plugin được phát hành trong Plugins Directory, bước terminal này sẽ được thay bằng nút **Install**.

## 2. Chạy hướng dẫn tự động

Nhập vào Codex:

```text
Setup Grok Imagine
```

Plugin sẽ kiểm tra Node.js, Codex, Grok CLI, kết nối xAI và thư mục lưu. Quá trình kiểm tra không tạo ảnh/video và không dùng lượt tạo media.

## 3. Kết nối tài khoản xAI

Bạn có hai lựa chọn:

- **xAI API key:** ổn định và phù hợp cho người dùng kỹ thuật. Tạo key trong tài khoản xAI Console của bạn, đặt biến môi trường `XAI_API_KEY`, rồi khởi động lại Codex. Không gửi key vào chat.
- **Grok CLI OAuth:** thuận tiện cho người dùng phổ thông. Cài Grok CLI chính thức, sau đó chạy `grok login --oauth` và đăng nhập trong trình duyệt.

Nếu máy không tự mở trình duyệt, dùng `grok login --device-auth`.

## 4. Kiểm tra kết quả

Nhập:

```text
Check Grok Imagine setup
```

- `PASS`: thành phần hoạt động.
- `WARN`: vẫn có thể hoạt động nhưng nên kiểm tra.
- `FAIL`: làm theo dòng `Fix`, rồi chạy lại kiểm tra.

Thiết lập được xem là hoàn tất khi doctor báo `READY`. Bạn không bắt buộc tạo ảnh thử.

## 5. Tạo ảnh/video đầu tiên

Việc tạo media có thể sử dụng hạn mức hoặc phát sinh chi phí trên tài khoản xAI của bạn. Sau khi kiểm tra quyền model và chi phí, thử:

```text
Tạo một ảnh thử 1:1 chất lượng thấp: cáo origami màu đỏ trên nền trắng.
```

File mặc định được lưu trong `grok-imagine-output` ở thư mục người dùng. Có thể đặt biến `GROK_IMAGINE_OUT` thành một đường dẫn tuyệt đối khác.

## Khi cần hỗ trợ

Gửi phần kết quả của `Check Grok Imagine setup`, nhưng xóa thông tin cá nhân nếu cần. Không bao giờ gửi `XAI_API_KEY`, access token, refresh token hoặc file `~/.grok/auth.json`.
