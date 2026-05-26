import React, { useState } from "react";
import { UploadCloud } from "lucide-react";

export default function UploadZone({ onUploadFile }) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf") {
        onUploadFile(file);
      } else {
        alert("PDF 파일만 지원됩니다.");
      }
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === "application/pdf") {
        onUploadFile(file);
      } else {
        alert("PDF 파일만 지원됩니다.");
      }
    }
  };

  return (
    <div
      className={`dropzone ${dragActive ? "dragover" : ""}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      onClick={() => document.getElementById("file-upload").click()}
    >
      <input
        id="file-upload"
        type="file"
        accept=".pdf"
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <UploadCloud className="dropzone-icon" />
      <span className="dropzone-text">PDF 파일을 여기에 끌어다 놓으세요</span>
      <span className="dropzone-subtext">또는 클릭하여 업로드</span>
    </div>
  );
}
